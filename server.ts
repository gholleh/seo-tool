import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Set payload limit higher to handle large batch requests
  app.use(express.json({ limit: '50mb' }));

  const parseGeminiJson = (text: string | null | undefined) => {
    if (!text) return {};
    try {
      const cleaned = text.replace(/^```(json)?|```$/gm, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse Gemini response:", text);
      const err = new Error("Invalid JSON response from Gemini");
      (err as any).status = 502;
      throw err;
    }
  };

  // --- GEMINI ROUTES ---
  app.post("/api/gemini/generate-seed", async (req, res) => {
    try {
      const { topic, count = 10 } = req.body;
      if (!topic) return res.status(400).json({ error: "Topic is required" });
      if (!process.env.GEMINI_API_KEY && !process.env.API_KEY) {
        return res.status(500).json({ error: "Gemini API Key is missing" });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY });
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          seedKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "The list of generated seed keywords."
          }
        },
        required: ["seedKeywords"]
      };

      const systemInstruction = `
        You are an SEO expert. 
        Your task is to generate starting "seed" keywords for keyword research based on the user's topic.
        Return exact phrases only, predominantly in Persian unless the topic demands English.
        Keep them short (1-3 words usually) and directly related.
      `;

      const prompt = `Topic: "${topic}"\nCount: Generate exactly ${count} seed keywords.`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: primaryModel,
          contents: prompt,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.7,
          },
        });
      } catch (e: any) {
        if (e.status === 429) {
          console.warn("Rate limited on primary model, trying fallback...");
          response = await ai.models.generateContent({
            model: fallbackModel,
            contents: prompt,
            config: {
              systemInstruction: systemInstruction,
              responseMimeType: "application/json",
              responseSchema: responseSchema,
              temperature: 0.7,
            },
          });
        } else {
          throw e;
        }
      }

      const text = response.text;
      const parsed = parseGeminiJson(text);
      return res.json({ seedKeywords: parsed.seedKeywords || [] });
    } catch (error: any) {
      console.error("Generate seed error:", error);
      let status = 500;
      if (typeof error.status === 'number') status = error.status;
      res.status(status).json({ error: error.message || error });
    }
  });

  app.post("/api/gemini/filter-keywords", async (req, res) => {
    try {
      const { keywords, userPrompt } = req.body;
      if (!keywords?.length) return res.json({ keptKeywords: [] });
      
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is missing. Please configure it." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          keptKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "The list of keywords that match the criteria and should be kept."
          },
          translations: {
            type: Type.OBJECT,
            description: "A mapping from the original keyword to its Persian translation. Only required if requested.",
            additionalProperties: { type: Type.STRING }
          }
        },
        required: ["keptKeywords"]
      };

      const systemInstruction = `
        You are a specialized SEO keyword filtering assistant.
        Your task is to analyze a list of keywords and filter them based strictly on the user's criteria.
        Rules:
        1. Return ONLY the keywords that satisfy the user's criteria.
        2. Do not modify the text of the keywords.
        3. If the user asks for Persian translations, provide them in the 'translations' object where the key is the original keyword and the value is the Persian meaning.
      `;

      const prompt = `User Criteria: "${userPrompt}"\nKeywords: ${JSON.stringify(keywords)}`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: primaryModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });
      } catch (e: any) {
        console.warn(`Primary model failed in filter-keywords: ${e.message}. Trying fallback...`);
        response = await ai.models.generateContent({
          model: fallbackModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });
      }

      const text = response.text;
      const parsed = parseGeminiJson(text);
      return res.json({ keptKeywords: parsed.keptKeywords || [], translations: parsed.translations || {} });
    } catch (error: any) {
      console.error("Filter keywords error:", error);
      let status = 500;
      if (typeof error.status === 'number') status = error.status;
      res.status(status).json({ error: error.message || error });
    }
  });

  app.post("/api/gemini/refine-clustering", async (req, res) => {
    try {
      const { batch, userContext } = req.body;
      if (!batch?.length) return res.json({ refinedClusters: [] });

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is missing. Please configure it." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          refinedClusters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                originalId: { type: Type.INTEGER, description: "The ID of the input cluster." },
                newClusterName: { type: Type.STRING, description: "Standardized Persian topic name for the URL slug/Title." },
                intent: { 
                  type: Type.STRING, 
                  enum: [
                    "Category", "SubCategory", "Product", "Blog", "Tag"
                  ]
                },
                parents: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Immediate parent name. Use 'Root' for top-level."
                },
                keywords: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "Keywords belonging to this specific intent group."
                }
              },
              required: ["originalId", "newClusterName", "intent", "keywords", "parents"]
            }
          }
        },
        required: ["refinedClusters"]
      };

      const systemInstruction = `
        You are a WordPress SEO Architect & Content Strategist.
        
        INPUT: A list of keyword clusters (ID + Keywords).
        OUTPUT: A structured architecture for a WordPress website (WooCommerce).
        
        ${userContext ? `**USER EXTRA INSTRUCTIONS:**\n${userContext}\n` : ''}

        **CRITICAL RULE 1: SPLITTING MIXED INTENTS (Separation)**
        - Analyze the keywords in EACH input cluster.
        - If a cluster (e.g., ID 36) contains keywords with DIFFERENT intents (e.g., "Buy Shoes" vs "How to clean shoes"), you MUST split them into separate output objects.
        - Example Input: ID 36 has ["buy nike", "nike price", "nike history", "cleaning nike"].
        - Example Output:
          1. { originalId: 36, newClusterName: "کفش نایک", intent: "Category", keywords: ["buy nike", "nike price"] }
          2. { originalId: 36, newClusterName: "تاریخچه نایک", intent: "Blog", keywords: ["nike history"] }
          3. { originalId: 36, newClusterName: "آموزش تمیز کردن کفش", intent: "Blog", keywords: ["cleaning nike"] }

        **CRITICAL RULE 2: STANDARDIZING FOR MERGING**
        - Use generic, consistent Persian names for 'newClusterName'.
        - If Input ID 24 is "Price of Nike" and Input ID 25 is "Nike Store", name BOTH of them "کفش نایک" (if they map to the same Category page).
        - My system will merge them if names match.

        **HIERARCHY (PARENTS):**
        - **Category**: Broad topic. Parent: 'Root' or another Category.
        - **SubCategory**: Specific topic. Parent: The related Category.
        - **Product**: A specific sellable item. Parent: The related SubCategory.
        - **Blog**: Informational content. Parent: 'Blog Root' or related Category.

        **INTENTS:**
        - Use strictly: "Category", "SubCategory", "Product", "Blog", "Tag".
      `;

      const prompt = `Architect these clusters for WordPress:\n${JSON.stringify(batch)}`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: primaryModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });
      } catch (e: any) {
        console.warn(`Primary model failed in refine-clustering: ${e.message}. Trying fallback...`);
        response = await ai.models.generateContent({
          model: fallbackModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });
      }

      const text = response.text;
      const parsed = parseGeminiJson(text);
      return res.json({ refinedClusters: parsed.refinedClusters || [] });

    } catch (error: any) {
      console.error("Refine clustering error:", error);
      let status = 500;
      if (typeof error.status === 'number') status = error.status;
      res.status(status).json({ error: error.message || error });
    }
  });

  app.post("/api/gemini/name-cluster", async (req, res) => {
    try {
      const { keywords } = req.body;
      if (!keywords?.length) return res.json({ pillarTitle: "نامشخص", urlSlug: "unknown" });

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is missing. Please configure it." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          pillarTitle: { type: Type.STRING, description: "A concise, engaging Persian title for the pillar page representing this cluster" },
          urlSlug: { type: Type.STRING, description: "A short, SEO-friendly English URL slug" }
        },
        required: ["pillarTitle", "urlSlug"]
      };

      const systemInstruction = `
        You are an expert SEO architect. 
        Given a list of semantically related keywords that form a cluster, generate:
        1. A concise, engaging Pillar Page Title in Persian.
        2. A short, SEO-friendly URL slug in English (words separated by hyphens).
      `;

      const prompt = `Keywords in cluster: ${JSON.stringify(keywords)}`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: primaryModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        });
      } catch (e: any) {
        if (e.status === 429) {
          console.warn("Rate limited on primary model in name-cluster, trying fallback...");
          response = await ai.models.generateContent({
            model: fallbackModel,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema,
              temperature: 0.1,
            },
          });
        } else {
          throw e;
        }
      }

      const text = response.text;
      const parsed = parseGeminiJson(text);
      return res.json({ 
        pillarTitle: parsed.pillarTitle || "نامشخص", 
        urlSlug: parsed.urlSlug || "unknown" 
      });
    } catch (error: any) {
      console.error("Name cluster error:", error);
      let status = 500;
      if (typeof error.status === 'number') status = error.status;
      res.status(status).json({ error: error.message || error });
    }
  });

  app.post("/api/gemini/generate-page-content", async (req, res) => {
    try {
      const { keywords, siteType } = req.body;
      
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is missing. Please configure it." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          pageTitle: { type: Type.STRING, description: "SEO optimized title tag (max 60 chars)" },
          urlSlug: { type: Type.STRING, description: "English URL slug" },
          metaDescription: { type: Type.STRING, description: "SEO meta description (max 160 chars)" },
          mainContent: { type: Type.STRING, description: "HTML formatted main content body (article or landing page text)" },
          categoryDescription: { type: Type.STRING, description: "HTML formatted description for category top/bottom" },
          suggestedProducts: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }, 
            description: "List of product names relevant to this page" 
          }
        },
        required: ["pageTitle", "urlSlug", "metaDescription", "mainContent", "categoryDescription", "suggestedProducts"]
      };

      const systemInstruction = `
        You are a professional SEO Content Writer and Strategist for the Persian market.
        
        Task: Create comprehensive on-page SEO content based on provided keywords.
        Language: Persian (Farsi).
        
        Constraints:
        1. **Page Title**: Compelling, includes main keyword, max 60 characters.
        2. **URL Slug**: English, hyphen-separated, concise.
        3. **Meta Description**: Click-worthy, includes LSI keywords, max 155-160 characters.
        4. **Main Content**: 
           - If SiteType is 'Blog': Write a detailed article outline/draft with H2, H3 tags in HTML.
           - If SiteType is 'Shop': Write a sales-oriented landing page intro.
        5. **Category Description**: A brief, SEO-rich paragraph describing the product category (if Shop) or topic (if Blog).
        6. **Products**: Suggest 3-5 specific product names that would sell well on this page.
      `;

      const prompt = `Keywords: ${(keywords || []).join(', ')}\nSite Type: ${siteType}`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: primaryModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.7,
          },
        });
      } catch (e: any) {
        console.warn(`Primary model failed in generate-page-content: ${e.message}. Trying fallback...`);
        response = await ai.models.generateContent({
          model: fallbackModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.7,
          },
        });
      }

      const text = response.text;
      const parsed = parseGeminiJson(text);
      return res.json(parsed);
    } catch (error: any) {
      console.error("Generate page content error:", error);
      let status = 500;
      if (typeof error.status === 'number') status = error.status;
      res.status(status).json({ error: error.message || error });
    }
  });

  // Proxy to avoid CORS for Mizfa API
  app.post("/api/mizfa/proxy", async (req, res) => {
    try {
      const { endpoint, baseUrl = 'https://api.mizfa.tools', method = 'POST', body, apiKey } = req.body;
      
      const targetUrl = `${baseUrl.replace(/\/$/, '')}${endpoint}`;
      
      const response = await fetch(targetUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      });
      
      const data = await response.json().catch(() => null);
      
      return res.status(response.status).json(data || { error: 'Unknown API Response' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Mizfa API proxy fetch failed' });
    }
  });

  // API Route for Google Suggestions
  app.get("/api/suggest", async (req, res) => {
    try {
      const query = req.query.q;
      const hl = req.query.hl || 'fa';
      const gl = req.query.gl || 'ir';

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const targetUrl = `https://suggestqueries.google.com/complete/search?client=chrome&hl=${hl}&gl=${gl}&q=${encodeURIComponent(query)}`;
      
      const proxies = [
        {
           name: 'direct',
           url: targetUrl
        },
        {
           name: 'corsproxy',
           url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
        },
        {
           name: 'api.allorigins',
           url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`
        }
      ];

      let lastError = null;

      for (const proxy of proxies) {
        try {
          const response = await fetch(proxy.url, {
            headers: {
              'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * 20) + 100}.0.0.0 Safari/537.36`,
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
            }
          });

          if (!response.ok) {
             throw new Error(`upstream returned ${response.status}`);
          }

          const data = await response.json();
          
          if (proxy.name === 'api.allorigins') {
             const parsedData = JSON.parse(data.contents);
             return res.json(parsedData);
          } else {
             return res.json(data);
          }
        } catch (e: any) {
          lastError = e;
          continue;
        }
      }

      res.status(500).json({ error: lastError?.message || 'All proxies failed' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Standard Production Serve
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
