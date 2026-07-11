// services/geminiService.ts

export const generateSeedKeywords = async (topic: string, count: number = 10) => {
  const response = await fetch('/api/gemini/generate-seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, count })
  });
  return await response.json();
};

export const filterKeywordsBatch = async (keywords: string[], userPrompt: string) => {
  const response = await fetch('/api/gemini/filter-keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, userPrompt })
  });
  return await response.json();
};

export const refineClusteringStrategy = async (clusters: any[], userContext: string = "") => {
  const response = await fetch('/api/gemini/refine-clustering', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clusters, userContext })
  });
  return await response.json();
};

export const nameCluster = async (keywords: string[]) => {
  const response = await fetch('/api/gemini/name-cluster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords })
  });
  return await response.json();
};

export const generatePageContent = async (keywords: string[], siteType: 'Shop' | 'Blog') => {
  const response = await fetch('/api/gemini/generate-page-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, siteType })
  });
  return await response.json();
};
