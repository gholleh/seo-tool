export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) return new Response("API Key error", { status: 500 });

  const body = await context.request.json();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: body.prompt }] }],
      systemInstruction: { parts: [{ text: "You are a specialized SEO keyword filtering assistant..." }] },
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    })
  });

  const data = await response.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
