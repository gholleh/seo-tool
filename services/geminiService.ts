// services/geminiService.ts

export const generateSeedKeywords = async (
  topic: string,
  count: number = 10
): Promise<string[]> => {
  if (!topic) return [];
  
  let retries = 0;
  const MAX_RETRIES = 3;

  while (retries <= MAX_RETRIES) {
    try {
      const response = await fetch('/api/gemini/generate-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, count })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Failed to generate seed keywords';
        const e = new Error(errMsg);
        (e as any).status = response.status;
        throw e;
      }

      const data = await response.json();
      return data.seedKeywords || [];
    } catch (error: any) {
      const isRetryable = error.status === 429 || error.status >= 500 || error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('429') || error.message?.includes('fetch');
      if (isRetryable && retries < MAX_RETRIES) {
        retries++;
        const waitTime = Math.pow(2, retries) * 4000;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate seed keywords after retries');
};

export const filterKeywordsBatch = async (
  keywords: string[],
  userPrompt: string
): Promise<{ keptKeywords: string[]; translations?: Record<string, string> }> => {
  if (!keywords.length) return { keptKeywords: [] };
  
  let retries = 0;
  const MAX_RETRIES = 3;

  while (retries <= MAX_RETRIES) {
    try {
      const response = await fetch('/api/gemini/filter-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, userPrompt })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Failed to filter keywords';
        const e = new Error(errMsg);
        (e as any).status = response.status;
        throw e;
      }

      return await response.json();
    } catch (error: any) {
      const isRetryable = error.status === 429 || error.status >= 500 || error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('429') || error.message?.includes('fetch');
      if (isRetryable && retries < MAX_RETRIES) {
        retries++;
        const waitTime = Math.pow(2, retries) * 4000;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to filter keywords after retries');
};

export const refineClusteringStrategy = async (
  clusters: { id: number; keywords: string[] }[],
  userContext: string = ""
): Promise<{ originalId: number; newClusterName: string; intent: string; parents: string[]; keywords: string[] }[]> => {
  if (!clusters.length) return [];
  
  const BATCH_SIZE = 5; 
  const results: { originalId: number; newClusterName: string; intent: string; parents: string[]; keywords: string[] }[] = [];

  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, i + BATCH_SIZE);
    let success = false;
    let retries = 0;
    const MAX_RETRIES = 5;

    while (!success && retries <= MAX_RETRIES) {
      try {
        const response = await fetch('/api/gemini/refine-clustering', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch, userContext })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const errMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Failed to refine clustering';
          const e = new Error(errMsg);
          (e as any).status = response.status;
          throw e;
        }

        const data = await response.json();
        if (data.refinedClusters && Array.isArray(data.refinedClusters)) {
          results.push(...data.refinedClusters);
        }
        success = true;
      } catch (error: any) {
        const isRetryable = error.status === 429 || error.status >= 500 || error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('429') || error.message?.includes('fetch');
        if (isRetryable) {
          retries++;
          if (retries <= MAX_RETRIES) {
            await new Promise(r => setTimeout(r, Math.pow(2, retries) * 4000));
            continue;
          }
        }
        break;
      }
    }

    if (!success) {
      batch.forEach(c => {
        results.push({
            originalId: c.id,
            newClusterName: "خطا در پردازش",
            intent: "Category",
            parents: ["Root"],
            keywords: c.keywords
        });
      });
    }
    if (i + BATCH_SIZE < clusters.length) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  return results;
};

export const nameCluster = async (
  keywords: string[]
): Promise<{ pillarTitle: string; urlSlug: string }> => {
  if (!keywords.length) return { pillarTitle: "نامشخص", urlSlug: "unknown" };
  
  let retries = 0;
  const MAX_RETRIES = 3;

  while (retries <= MAX_RETRIES) {
    try {
      const response = await fetch('/api/gemini/name-cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Failed to name cluster';
        const e = new Error(errMsg);
        (e as any).status = response.status;
        throw e;
      }
      return await response.json();
    } catch (error: any) {
      const isRetryable = error.status === 429 || error.status >= 500 || error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('429') || error.message?.includes('fetch');
      if (isRetryable && retries < MAX_RETRIES) {
        retries++;
        await new Promise(r => setTimeout(r, Math.pow(2, retries) * 4000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to name cluster after retries');
};
