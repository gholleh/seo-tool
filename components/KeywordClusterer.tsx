import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  Settings, 
  Play, 
  Download, 
  CheckCircle2, 
  Terminal,
  Loader2,
  FileSpreadsheet,
  PieChart,
  BarChart3,
  Globe,
  Square
} from 'lucide-react';

import { nameCluster } from '../services/geminiService';

interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: string;
}

// CTR Map based on position (Percentages)
const CTR_MAP: Record<number, number> = {
  1: 39.8,
  2: 18.7,
  3: 10.2,
  4: 7.3,
  5: 5.9,
  6: 4.9,
  7: 4.2,
  8: 3.6,
  9: 3.1,
  10: 2.8
};

export default function KeywordClusterer() {
  const [file, setFile] = useState<File | null>(null);
  const [domain, setDomain] = useState<string>('');
  const [apiKeysInput, setApiKeysInput] = useState<string>('');
  const [threshold, setThreshold] = useState<number>(5);
  
  // New Settings
  const [serpLang, setSerpLang] = useState<string>('fa');
  const [serpLoc, setSerpLoc] = useState<string>('ir');
  const [clusteringAlgorithm, setClusteringAlgorithm] = useState<'greedy' | 'hybrid' | 'hybrid_no_ai'>('hybrid');

  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');

  const [columns, setColumns] = useState<string[]>([]);
  const [queryColumn, setQueryColumn] = useState<string>('');
  const [impressionColumn, setImpressionColumn] = useState<string>('');
  const [uploadedData, setUploadedData] = useState<any[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = React.useRef<AbortController | null>(null);
  
  // Base Data (SERP Only)
  const [baseSerpData, setBaseSerpData] = useState<any[] | null>(null);
  const [marketShare, setMarketShare] = useState<any[] | null>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 100));
  };

  const loadSheetData = (wb: XLSX.WorkBook, sheetName: string) => {
    try {
      const sheet = wb.Sheets[sheetName];
      const rawJson: any[] = XLSX.utils.sheet_to_json(sheet);
      
      if (rawJson.length > 0) {
        const cols = Object.keys(rawJson[0]);
        setColumns(cols);
        
        // Auto-detect
        const autoQuery = cols.find(c => ['top_queries', 'keyword', 'query', 'top queries', 'کلمه کلیدی', 'کلمات کلیدی'].includes(c.toLowerCase().trim()));
        if (autoQuery) setQueryColumn(autoQuery);
        else setQueryColumn(cols[0] || '');
        
        const autoImp = cols.find(c => ['volume', 'search_volume', 'impressions', 'impression', 'vol', 'جستجو', 'ایمپرشن'].includes(c.toLowerCase().trim()));
        if (autoImp) setImpressionColumn(autoImp);
        else setImpressionColumn(cols[1] || cols[0] || '');
        
        setUploadedData(rawJson);
      } else {
        addLog(`شیت ${sheetName} خالی است.`, 'error');
        setColumns([]);
        setUploadedData([]);
      }
    } catch (error: any) {
      addLog(`خطا در خواندن شیت: ${error.message}`, 'error');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      addLog(`فایل انتخاب شد: ${selectedFile.name}`, 'info');

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = event.target?.result;
          const wb = XLSX.read(data, { type: 'binary' });
          setWorkbook(wb);
          const names = wb.SheetNames;
          setSheetNames(names);
          
          if (names.length > 0) {
              const firstSheet = names[0];
              setSelectedSheet(firstSheet);
              loadSheetData(wb, firstSheet);
          }
        } catch (error: any) {
          addLog(`خطا در خواندن فایل: ${error.message}`, 'error');
        }
      };
      reader.readAsBinaryString(selectedFile);
    }
  };

  const handleSheetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const s = e.target.value;
      setSelectedSheet(s);
      if (workbook) loadSheetData(workbook, s);
  };

  let currentApiIndex = 0;

  const getTopAddresses = async (keyword: string, currentDomain: string, keys: string[], gl: string, hl: string, signal?: AbortSignal) => {
      const url = "https://google.serper.dev/search";
      const payload = JSON.stringify({ q: keyword, gl: gl, hl: hl });

      let attempts = 0;
      while (attempts < keys.length) {
          if (signal?.aborted) return { addresses: [], ourRank: null, ourUrl: null };
          
          const activeKey = keys[currentApiIndex % keys.length].trim();
          if (!activeKey) {
              attempts++;
              currentApiIndex++;
              continue;
          }

          const headers = { 'X-API-KEY': activeKey, 'Content-Type': 'application/json' };

          try {
              const response = await fetch(url, { method: 'POST', headers, body: payload, signal });
              
              if (!response.ok) {
                  // Switch key if forbidden/unauthorized/quota
                  if ([401, 402, 403, 429].includes(response.status)) {
                      attempts++;
                      currentApiIndex++;
                      continue;
                  }
                  throw new Error(`Serper API Error: ${response.status}`);
              }
              
              const data = await response.json();
              const addresses: string[] = [];
              let ourRank: number | null = null;
              let ourUrl: string | null = null;
              let exactMatchTitleCount = 0;
              
              if (data.answerBox) {
                  if (data.answerBox.link) addresses.push(data.answerBox.link);
                  if (data.answerBox.title && data.answerBox.title.toLowerCase().includes(keyword.toLowerCase())) {
                      exactMatchTitleCount++;
                  }
              }

              const items = data.organic || [];
              items.forEach((item: any) => {
                  const link = item.link || '';
                  const title = item.title || '';
                  if (title.toLowerCase().includes(keyword.toLowerCase())) {
                      exactMatchTitleCount++;
                  }
                  if (link && !addresses.includes(link)) {
                      addresses.push(link);
                  }
              });

              addresses.forEach((link: string, idx: number) => {
                  if (link && currentDomain && link.includes(currentDomain) && ourRank === null) {
                      ourRank = idx + 1;
                      ourUrl = link;
                  }
              });

              return { addresses, ourRank, ourUrl, exactMatchTitleCount };
          } catch (error: any) {
              if (error.name === 'AbortError') throw error;
              attempts++;
              currentApiIndex++;
          }
      }
      return { addresses: [], ourRank: null, ourUrl: null };
  };

  const stopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addLog('پردازش توسط کاربر متوقف شد.', 'warning');
    }
  };

  const handleRun = async () => {
    if (!file) return addLog('لطفا فایل اکسل را انتخاب کنید.', 'error');
    if (!queryColumn) return addLog('لطفا ستون کلمات کلیدی را انتخاب کنید.', 'error');
    if (!impressionColumn) return addLog('لطفا ستون میزان جستجو را انتخاب کنید.', 'error');
    
    const validKeys = apiKeysInput.split('\n').map(k => k.trim()).filter(k => k);
    if (validKeys.length === 0) return addLog('لطفا حداقل یک API Key سرویس Serper را وارد کنید.', 'error');

    setIsProcessing(true);
    setLogs([]);
    setBaseSerpData(null);
    setMarketShare(null);
    setProgress({ current: 0, total: 0 });
    currentApiIndex = 0;
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
        const originalDataMap = new Map<string, any>();
        const volumeMap = new Map<string, number>();
        let totalTotalImpressions = 0;
        
        // Filter and Normalize
        const keywordsData = uploadedData.filter(row => {
            const kw = String(row[queryColumn] || '').trim();
            if (kw) {
                originalDataMap.set(kw, row); 
                
                const vol = Number(row[impressionColumn]) || 0;
                
                volumeMap.set(kw, vol);
                totalTotalImpressions += vol;

                return true;
            }
            return false;
        }).map(row => {
             return { top_queries: String(row[queryColumn]).trim() };
        });

        if (keywordsData.length === 0) {
            setIsProcessing(false);
            return addLog('هیچ کلمه‌ای در ستون انتخاب شده یافت نشد.', 'error');
        }

        if (totalTotalImpressions === 0) {
            addLog('هشدار: ستون Impression/Volume پیدا نشد یا مقادیر صفر است. محاسبات سهم بازار دقیق نخواهد بود.', 'error');
            // If no volume, assign 1 to everything to prevent division by zero and act as count-based
            totalTotalImpressions = keywordsData.length;
            keywordsData.forEach(k => volumeMap.set(k.top_queries, 1));
        } else {
            addLog(`مجموع Impression شناسایی شده: ${totalTotalImpressions.toLocaleString()}`, 'info');
        }

        addLog(`${keywordsData.length} کلمه کلیدی یافت شد. شروع پردازش با تنظیمات: ${serpLoc.toUpperCase()} / ${serpLang}...`, 'info');
        setProgress({ current: 0, total: keywordsData.length });

        // Step 1: Fetch SERP Data
        const serpResults: Record<string, any> = {};
        const BATCH_SIZE = 3;
        for (let i = 0; i < keywordsData.length; i += BATCH_SIZE) {
            if (signal.aborted) break;
            const batch = keywordsData.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (row) => {
                const kw = row.top_queries;
                const res = await getTopAddresses(kw, domain, validKeys, serpLoc, serpLang, signal);
                serpResults[kw] = res;
            }));
            
            setProgress({ current: Math.min(i + BATCH_SIZE, keywordsData.length), total: keywordsData.length });
            if (!signal.aborted) await new Promise(r => setTimeout(r, 500));
        }

        if (signal.aborted) {
            addLog('پردازش به دلیل درخواست کاربر متوقف شد.', 'warning');
            setIsProcessing(false);
            return;
        }

        // Step 2: Market Share (Weighted by Impression * CTR)
        addLog('در حال محاسبه سهم بازار (Impression * CTR)...', 'info');
        const domainTraffic: Record<string, number> = {};
        let totalEstimatedTraffic = 0; // Currently not used for "Share of Voice", but useful for debugging

        Object.entries(serpResults).forEach(([kw, res]: [string, any]) => {
            const addresses = res.addresses || [];
            const keywordVol = volumeMap.get(kw) || 0;

            addresses.forEach((url: string, index: number) => {
                const rank = index + 1;
                if (rank > 10) return;

                const ctrPercent = CTR_MAP[rank] || 0;
                // Formula: Impression * CTR. 
                // Note: CTR_MAP is percentage (e.g. 39.8). 
                // Weighted Score = Volume * (CTR / 100)
                const trafficContribution = keywordVol * (ctrPercent / 100);
                
                try {
                    const hostname = new URL(url).hostname.replace(/^www\./, '');
                    if (hostname) {
                        domainTraffic[hostname] = (domainTraffic[hostname] || 0) + trafficContribution;
                        totalEstimatedTraffic += trafficContribution;
                    }
                } catch (e) {}
            });
        });

        // Share % = (Domain Weighted Traffic / Total Total Impressions) * 100?
        // Or Share % = (Domain Weighted Traffic / Total Estimated Traffic of all domains)?
        // Requirement: "مجموع ایمپرشن * CTR تقسیم بر مجموع ایمپرشن همه کلمات"
        // Denominator is `totalTotalImpressions`.
        
        const marketShareList = Object.entries(domainTraffic)
            .map(([domain, traffic]) => ({
                Domain: domain,
                'Est. Traffic': Math.round(traffic).toLocaleString(),
                'Share (%)': totalEstimatedTraffic > 0 ? ((traffic / totalEstimatedTraffic) * 100).toFixed(2) : "0"
            }))
            .sort((a, b) => parseFloat(b['Share (%)']) - parseFloat(a['Share (%)']));
        
        setMarketShare(marketShareList);
        
        // Step 3: Overlap Clustering
        addLog(`در حال خوشه‌بندی با الگوریتم ${clusteringAlgorithm.startsWith('hybrid') ? 'هیبریدی' : 'حریصانه'}...`, 'info');
        let clusters: string[][] = [];
        const keywordsList = keywordsData.map(r => r.top_queries);

        if (clusteringAlgorithm === 'greedy') {
            const visited = new Set<string>();
            for (let i = 0; i < keywordsList.length; i++) {
                const kw1 = keywordsList[i];
                if (visited.has(kw1)) continue;

                const cluster = [kw1];
                visited.add(kw1);
                const set1 = new Set(serpResults[kw1]?.addresses || []);

                for (let j = i + 1; j < keywordsList.length; j++) {
                    const kw2 = keywordsList[j];
                    if (visited.has(kw2)) continue;

                    const set2 = new Set(serpResults[kw2]?.addresses || []);
                    const intersection = new Set([...set1].filter(x => set2.has(x)));
                    
                    if (intersection.size >= threshold) {
                        cluster.push(kw2);
                        visited.add(kw2);
                    }
                }
                clusters.push(cluster);
            }
        } else {
            // PHASE 1: Graph-based Connected Components
            const adjList = new Map<string, string[]>();
            keywordsList.forEach(k => adjList.set(k, []));
            
            addLog('در حال ساخت گراف ارتباطی...', 'info');
            for (let i = 0; i < keywordsList.length; i++) {
                if (i % 100 === 0) await new Promise(r => setTimeout(r, 0)); // yield
                const kw1 = keywordsList[i];
                const set1 = new Set(serpResults[kw1]?.addresses || []);
                
                for (let j = i + 1; j < keywordsList.length; j++) {
                    const kw2 = keywordsList[j];
                    const set2 = new Set(serpResults[kw2]?.addresses || []);
                    let overlap = 0;
                    for (const url of set1) {
                        if (set2.has(url)) overlap++;
                    }
                    if (overlap >= threshold) {
                        adjList.get(kw1)!.push(kw2);
                        adjList.get(kw2)!.push(kw1);
                    }
                }
            }
            
            const visited = new Set<string>();
            for (const kw of keywordsList) {
                if (visited.has(kw)) continue;
                const comp: string[] = [];
                const queue = [kw];
                visited.add(kw);
                
                while(queue.length > 0) {
                    const curr = queue.shift()!;
                    comp.push(curr);
                    for (const neighbor of adjList.get(curr) || []) {
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.push(neighbor);
                        }
                    }
                }
                
                // PHASE 2: Noise Filtering
                if (comp.length > 2) {
                    let totalOverlap = 0;
                    let edgesCount = 0;
                    const kwOverlaps = new Map<string, number>();
                    
                    for (let i = 0; i < comp.length; i++) {
                        const kw1 = comp[i];
                        const set1 = new Set(serpResults[kw1]?.addresses || []);
                        let myOverlapSum = 0;
                        for (let j = 0; j < comp.length; j++) {
                            if (i === j) continue;
                            const kw2 = comp[j];
                            const set2 = new Set(serpResults[kw2]?.addresses || []);
                            let overlap = 0;
                            for (const url of set1) if (set2.has(url)) overlap++;
                            myOverlapSum += overlap;
                            if (i < j) {
                                totalOverlap += overlap;
                                edgesCount++;
                            }
                        }
                        kwOverlaps.set(kw1, myOverlapSum / (comp.length - 1));
                    }
                    
                    const avgComponentOverlap = edgesCount > 0 ? (totalOverlap / edgesCount) : 0;
                    const mainCluster: string[] = [];
                    for (const kw of comp) {
                        const avgOvl = kwOverlaps.get(kw) || 0;
                        if (avgOvl < avgComponentOverlap * 0.5) {
                            clusters.push([kw]); // Standalone
                        } else {
                            mainCluster.push(kw);
                        }
                    }
                    if (mainCluster.length > 0) clusters.push(mainCluster);
                } else {
                    clusters.push(comp);
                }
            }
        }

        // Calculate Cluster Impressions and sort clusters
        addLog('در حال ساختاربندی خوشه‌ها...', 'info');
        const clustersWithImpression = clusters.map((cluster, idx) => {
            // Phase 3: Hierarchy Extraction (sort by Volume)
            const sortedKeywords = [...cluster].sort((a, b) => (volumeMap.get(b) || 0) - (volumeMap.get(a) || 0));
            
            let totalImpression = 0;
            sortedKeywords.forEach(kw => {
                totalImpression += (volumeMap.get(kw) || 0);
            });
            return {
                originalId: idx + 1,
                keywords: sortedKeywords,
                totalImpression,
                pillarTitle: sortedKeywords[0],
                urlSlug: ''
            };
        });

        // Sort clusters from highest impression to lowest
        clustersWithImpression.sort((a, b) => b.totalImpression - a.totalImpression);
        
        if (clusteringAlgorithm === 'hybrid') {
             addLog('در حال نام‌گذاری هوشمند خوشه‌ها (Phase 4)...', 'info');
             // Chunk it so we don't spam API
             const BATCH_SIZE = 5;
             for (let i = 0; i < clustersWithImpression.length; i += BATCH_SIZE) {
                 if (signal.aborted) break;
                 const batch = clustersWithImpression.slice(i, i + BATCH_SIZE);
                 await Promise.all(batch.map(async (c) => {
                     try {
                         const res = await nameCluster(c.keywords);
                         c.pillarTitle = res.pillarTitle;
                         c.urlSlug = res.urlSlug;
                     } catch(e) {
                         // fallback to main keyword
                         c.pillarTitle = c.keywords[0];
                     }
                 }));
                 if (!signal.aborted && i + BATCH_SIZE < clustersWithImpression.length) {
                     await new Promise(r => setTimeout(r, 1000));
                 }
             }
        }

        // Prepare Final Rows (Preserving Original Columns + Cluster Impression)
        const finalRows: any[] = [];
        clustersWithImpression.forEach((clusterObj, idx) => {
            const clusterId = idx + 1; // Re-assign ID based on sorted order
            const clusterTotalImpression = clusterObj.totalImpression;
            const isHybrid = clusteringAlgorithm.startsWith('hybrid');

            clusterObj.keywords.forEach((kw, kwIdx) => {
                const serp = serpResults[kw];
                const originalRow = originalDataMap.get(kw) || {};
                
                finalRows.push({
                    'Cluster ID': clusterId,
                    'Cluster Name (Pillar)': isHybrid ? clusterObj.pillarTitle : clusterObj.keywords[0],
                    'URL Slug': isHybrid ? clusterObj.urlSlug : '',
                    'Role': kwIdx === 0 ? 'Pillar' : 'Cluster Page',
                    'Cluster Total Impression': clusterTotalImpression,
                    ...originalRow,
                    'Exact Match in Title': serp?.exactMatchTitleCount || 0,
                    'Our Rank': serp?.ourRank || '',
                    'Our URL': serp?.ourUrl || '',
                    'Ranking URLs': (serp?.addresses || []).join('\n')
                });
            });
        });

        setBaseSerpData(finalRows);
        addLog(`پردازش تمام شد. ${clustersWithImpression.length} خوشه ایجاد شد.`, 'success');

      } catch (err: any) {
        if (err.name === 'AbortError') {
            addLog('آماده‌سازی لغو شد.', 'warning');
        } else {
            console.error(err);
            addLog('خطا در پردازش فایل: ' + err.message, 'error');
        }
      } finally {
        setIsProcessing(false);
      }
  };

  // ----- Advanced Analytical Features Helper functions -----
  const PERSIAN_STOP_WORDS = new Set(['از', 'به', 'در', 'با', 'و', 'که', 'این', 'است', 'برای', 'یک', 'می', 'های', 'را', 'تا', 'هم', 'آن', 'یا', 'شده', 'دارد', 'شود', 'شما', 'ما', 'چیست', 'چگونه', 'چرا', 'چه', 'آیا', 'کجا', 'کی', 'کردن', 'کرد', 'بود', 'شد', 'است', 'هست', 'بودن', 'قیمت', 'خرید', 'فروش', 'سایت', 'سامانه', 'آنلاین', 'بهترین', 'ارزان', 'ترین', 'بدون', 'ها']);

  const jaccardSimilarity = (str1: string, str2: string) => {
      const set1 = new Set(str1.split(' '));
      const set2 = new Set(str2.split(' '));
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      return intersection.size / (union.size || 1);
  };

  const extractEntities = (queries: string[], stopWords: Set<string>): string => {
      const counts = new Map<string, number>();
      queries.forEach(q => {
          const words = q.split(/\s+/);
          words.forEach(w => {
              if (w.length > 2 && !stopWords.has(w)) {
                  counts.set(w, (counts.get(w) || 0) + 1);
              }
          });
      });
      return Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(x => x[0])
          .join(', ');
  };

  const generateStrategicSheetData = (clustersData: any[], marketShareData: any[], targetDomain: string, qCol: string, impCol: string) => {
      const groupedClusters = new Map<number, any>();
      let allImpressions: number[] = [];
      
      clustersData.forEach(row => {
          const cId = Number(row['Cluster ID']);
          const kw = String(row[qCol] || row['top_queries'] || row['keyword'] || row['Query'] || '').trim();
          const urls = typeof row['Ranking URLs'] === 'string' ? row['Ranking URLs'].split('\n') : [];
          const cImp = Number(row['Cluster Total Impression']) || 0;
          const pillarName = row['Cluster Name (Pillar)'];
          
          if (!groupedClusters.has(cId)) {
              groupedClusters.set(cId, {
                  clusterId: cId,
                  totalImpression: cImp,
                  queries: [],
                  pillarName: pillarName,
                  ourRank: Number(row['Our Rank']) || null,
                  ourUrl: row['Our URL'] ? row['Our URL'] : null,
                  urls: new Set(urls),
                  ourEstTraffic: 0,
                  compTraffic: {} as Record<string, number>
              });
              if (cImp > 0) allImpressions.push(cImp);
          }
          
          const cluster = groupedClusters.get(cId);
          if (kw) cluster.queries.push(kw);
          
          const currentRank = Number(row['Our Rank']) || null;
          const rImp = Number(row[impCol]) || 0;

          if (currentRank && currentRank > 0 && currentRank <= 10) {
              cluster.ourEstTraffic += rImp * ((CTR_MAP[currentRank] || 0) / 100);
          }

          if (currentRank && (!cluster.ourRank || currentRank < cluster.ourRank)) {
              cluster.ourRank = currentRank;
              cluster.ourUrl = row['Our URL'] ? row['Our URL'] : null;
          }
          urls.forEach((u: string) => cluster.urls.add(u));
          
          urls.forEach((url: string, index: number) => {
              const rank = index + 1;
              if (rank <= 10) {
                  try {
                      const hostname = new URL(url).hostname.replace(/^www\./, '');
                      if (hostname) {
                          const trafficContribution = rImp * ((CTR_MAP[rank] || 0) / 100);
                          cluster.compTraffic[hostname] = (cluster.compTraffic[hostname] || 0) + trafficContribution;
                      }
                  } catch (e) {}
              }
          });
      });
      
      allImpressions.sort((a,b) => b - a);
      const top30PercentileCutoff = allImpressions[Math.floor(allImpressions.length * 0.3)] || 0;
      
      const topCompetitors = (marketShareData || [])
        .filter(r => r['Domain'] && !r['Domain'].includes(targetDomain))
        .slice(0, 5)
        .map(r => r['Domain']);

      const clustersList = Array.from(groupedClusters.values());

      clustersList.forEach(c => {
          c.entityString = extractEntities(c.queries, PERSIAN_STOP_WORDS);
          c.mainEntity = c.pillarName || c.entityString.split(', ')[0] || c.queries[0] || 'عمومی';

          // Calculate Top 5 Competitors for this cluster
          const compTrafficEntries = Object.entries(c.compTraffic as Record<string, number>)
              .filter(([domain]) => domain !== targetDomain && !domain.includes(targetDomain))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
          
          c.topCompetitorsSov = compTrafficEntries.map(([domain, traffic]) => {
              const sov = c.totalImpression > 0 ? ((traffic / c.totalImpression) * 100).toFixed(2) : "0.00";
              return { domain, sov };
          });
      });

      return clustersList.map(cluster => {
          const pillarTopic = cluster.mainEntity;
          
          const similarClusters = clustersList
            .filter(c => c.clusterId !== cluster.clusterId && c.ourUrl)
            .map(c => ({ url: c.ourUrl, sim: jaccardSimilarity(cluster.entityString, c.entityString) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 2);
            
          const suggestedLinks = similarClusters.map(s => s.url).join('\n') || 'N/A';
          const entities = cluster.entityString;
          
          let sovPercent = "0.00";
          if (cluster.totalImpression > 0) {
              sovPercent = ((cluster.ourEstTraffic / cluster.totalImpression) * 100).toFixed(2);
          }
          
          const mainQuery = cluster.queries[0] || '-';

          const result: any = {
              'Cluster ID': cluster.clusterId,
              'Main Query': mainQuery,
              'Total Impression': cluster.totalImpression,
              'Our Best Rank': cluster.ourRank || '-',
              'Parent Pillar Topic': pillarTopic,
              'Must Include Entities': entities,
              'Suggested Internal Links': suggestedLinks,
              'Our SOV (%)': sovPercent + '%'
          };

          cluster.topCompetitorsSov.forEach((comp: any, i: number) => {
              result[`Competitor ${i+1}`] = comp.domain;
              result[`Competitor ${i+1} SOV (%)`] = comp.sov + '%';
          });
          
          // Fill empty ones if less than 5
          for (let i = (cluster.topCompetitorsSov?.length || 0); i < 5; i++) {
              result[`Competitor ${i+1}`] = '-';
              result[`Competitor ${i+1} SOV (%)`] = '-';
          }
          
          return result;
      });
  };

  const handleDownloadExcel = () => {
    if (!baseSerpData) return;
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: SERP Clusters
    const ws1 = XLSX.utils.json_to_sheet(baseSerpData);
    ws1['!cols'] = Object.keys(baseSerpData[0] || {}).map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws1, "SERP Clusters");
    
    // Sheet 2: Market Share
    if (marketShare) {
        const ws2 = XLSX.utils.json_to_sheet(marketShare);
        ws2['!cols'] = Object.keys(marketShare[0] || {}).map(() => ({ wch: 15 }));
        XLSX.utils.book_append_sheet(wb, ws2, "Market Share");
    }

    // Sheet 3: Strategic Action Plan
    const strategicData = generateStrategicSheetData(baseSerpData, marketShare || [], domain || "bimeh.com", queryColumn, impressionColumn);
    if (strategicData.length > 0) {
      const ws3 = XLSX.utils.json_to_sheet(strategicData);
      ws3['!cols'] = Object.keys(strategicData[0]).map(() => ({ wch: 25 }));
      XLSX.utils.book_append_sheet(wb, ws3, "Strategic_Action_Plan");
    }

    let filename = `SEO_Clusters_Analysis_${new Date().getTime()}.xlsx`;
    if (baseSerpData.length > 0) {
        const firstRow = baseSerpData[0] as any;
        const firstKeyword = firstRow[queryColumn] || firstRow['Keyword'] || firstRow['کلمه کلیدی'] || firstRow[Object.keys(firstRow)[0]];
        if (firstKeyword && typeof firstKeyword === 'string') {
             const safeKeyword = firstKeyword.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').trim().replace(/\s+/g, '_');
             if (safeKeyword) filename = `SEO_Clusters_${safeKeyword}.xlsx`;
        }
    }

    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
       {/* Config Panel */}
       <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
             <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
               <Settings size={20} className="text-green-600" />
               تنظیمات SERP
             </h2>

             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">فایل اکسل کلمات</label>
                 <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-500 transition-colors">
                    <input 
                        type="file" 
                        accept=".xlsx" 
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={isProcessing}
                    />
                    <div className="flex flex-col items-center gap-2 text-gray-500">
                        <FileSpreadsheet size={32} />
                        <span className="text-xs">{file ? file.name : "فایل را اینجا رها کنید"}</span>
                    </div>
                 </div>
                 <p className="text-xs text-gray-400 mt-1">اکسل باید شامل ستون کلمات (Keyword) و ایمپرشن (Impression) باشد.</p>
               </div>

               {sheetNames.length > 1 && (
                 <div>
                   <label className="block text-sm font-medium text-gray-700 mb-1">انتخاب شیت اکسل</label>
                   <select 
                     value={selectedSheet} 
                     onChange={handleSheetChange}
                     className="w-full p-2 border border-gray-300 rounded-md text-sm"
                     disabled={isProcessing}
                   >
                     {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                   </select>
                 </div>
               )}

               {columns.length > 0 && (
                 <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                   <div>
                     <label className="block text-xs font-medium text-gray-700 mb-1">ستون کلمه کلیدی</label>
                     <select 
                       value={queryColumn} 
                       onChange={(e) => setQueryColumn(e.target.value)}
                       className="w-full p-2 border border-gray-300 rounded-md text-xs"
                       disabled={isProcessing}
                     >
                       {columns.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                   </div>
                   <div>
                     <label className="block text-xs font-medium text-gray-700 mb-1">ستون ایمپرشن/جستجو</label>
                     <select 
                       value={impressionColumn} 
                       onChange={(e) => setImpressionColumn(e.target.value)}
                       className="w-full p-2 border border-gray-300 rounded-md text-xs"
                       disabled={isProcessing}
                     >
                       {columns.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                   </div>
                 </div>
               )}

               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">دامنه هدف (جهت ردیابی رتبه)</label>
                 <input 
                   type="text" 
                   value={domain}
                   onChange={(e) => setDomain(e.target.value)}
                   placeholder="example.com"
                   className="w-full p-2 border border-gray-300 rounded-md text-sm text-left ltr"
                   disabled={isProcessing}
                 />
               </div>

               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Serper API Key(s)</label>
                 <textarea 
                   rows={3}
                   value={apiKeysInput}
                   onChange={(e) => setApiKeysInput(e.target.value)}
                   placeholder="میتوانید چند کلید را با Enter جدا کنید..."
                   className="w-full p-2 border border-gray-300 rounded-md text-sm text-left ltr resize-y"
                   disabled={isProcessing}
                 />
               </div>

                {/* Location & Language */}
               <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <Globe size={12} />
                        کشور (gl)
                    </label>
                    <select 
                      value={serpLoc} 
                      onChange={(e) => setSerpLoc(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md text-sm"
                      disabled={isProcessing}
                    >
                      <option value="ir">Iran (ir)</option>
                      <option value="iq">Iraq (iq)</option>
                      <option value="ae">UAE (ae)</option>
                      <option value="tr">Turkey (tr)</option>
                      <option value="sa">Saudi Arabia (sa)</option>
                      <option value="qa">Qatar (qa)</option>
                      <option value="om">Oman (om)</option>
                      <option value="kw">Kuwait (kw)</option>
                      <option value="bh">Bahrain (bh)</option>
                      <option value="us">USA (us)</option>
                      <option value="gb">UK (gb)</option>
                      <option value="de">Germany (de)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">زبان (hl)</label>
                    <select 
                      value={serpLang} 
                      onChange={(e) => setSerpLang(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md text-sm"
                      disabled={isProcessing}
                    >
                      <option value="fa">Persian (fa)</option>
                      <option value="en">English (en)</option>
                      <option value="ar">Arabic (ar)</option>
                      <option value="tr">Turkish (tr)</option>
                      <option value="de">German (de)</option>
                    </select>
                  </div>
               </div>

               <div>
                 <div className="flex justify-between mb-1">
                   <label className="text-sm font-medium text-gray-700">آستانه همپوشانی (Threshold)</label>
                   <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{threshold} لینک مشترک</span>
                 </div>
                 <input 
                   type="range" 
                   min="1" 
                   max="10" 
                   value={threshold}
                   onChange={(e) => setThreshold(Number(e.target.value))}
                   className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                   disabled={isProcessing}
                 />
               </div>

               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">الگوریتم خوشه‌بندی</label>
                 <select 
                   value={clusteringAlgorithm} 
                   onChange={(e) => setClusteringAlgorithm(e.target.value as 'greedy' | 'hybrid' | 'hybrid_no_ai')}
                   className="w-full p-2 border border-gray-300 rounded-md text-sm"
                   disabled={isProcessing}
                 >
                   <option value="hybrid">الگوریتم هیبریدی (پیشرفته - گراف + هوش مصنوعی)</option>
                   <option value="hybrid_no_ai">الگوریتم هیبریدی (پیشرفته - فقط گراف)</option>
                   <option value="greedy">الگوریتم حریصانه (ساده و سریع)</option>
                 </select>
               </div>

               {isProcessing ? (
                 <button 
                   onClick={stopProcessing}
                   className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition-all mt-4"
                 >
                   <Square size={18} className="fill-current" />
                   <span>توقف پردازش</span>
                 </button>
               ) : (
                 <button 
                   onClick={handleRun}
                   className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-all mt-4"
                 >
                   <Play size={18} />
                   <span>شروع خوشه‌بندی</span>
                 </button>
               )}

               {progress.total > 0 && (
                 <div className="mt-4">
                   <div className="flex justify-between text-xs text-gray-600 mb-1">
                     <span>پیشرفت ({Math.round(progress.current/progress.total*100) || 0}%)</span>
                     <span>{progress.current} / {progress.total}</span>
                   </div>
                   <div className="w-full bg-gray-200 rounded-full h-2">
                     <div 
                       className="bg-green-600 h-2 rounded-full transition-all duration-300"
                       style={{ width: `${Math.max(0, Math.min(100, (progress.current / progress.total) * 100))}%` }}
                     ></div>
                   </div>
                 </div>
               )}
             </div>
          </div>

          <div className="bg-gray-900 rounded-xl shadow-sm border border-gray-800 p-4 h-64 flex flex-col">
             <h2 className="text-xs font-mono text-gray-400 mb-2 flex items-center gap-2 border-b border-gray-700 pb-2">
              <Terminal size={14} />
              Logs
            </h2>
            <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 custom-scrollbar">
              {logs.map((log) => (
                <div key={log.id} className={`flex gap-2 ${
                  log.type === 'error' ? 'text-red-400' : 
                  log.type === 'success' ? 'text-green-400' : 'text-gray-300'
                }`}>
                  <span className="text-gray-600">[{log.timestamp}]</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
       </div>

       {/* Result Panel */}
       <div className="lg:col-span-8 flex flex-col h-full space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col min-h-[400px]">
                {baseSerpData ? (
                    <div className="flex-1 flex flex-col gap-6">
                        
                        {/* Summary Header */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center gap-3">
                                <div className="bg-green-500 text-white p-2 rounded-full">
                                    <CheckCircle2 size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800">نتایج خوشه‌بندی SERP</h3>
                                    <p className="text-sm text-gray-600">{baseSerpData.length} کلمه پردازش شد</p>
                                </div>
                            </div>
                            
                            <button 
                                onClick={handleDownloadExcel}
                                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                            >
                                <Download size={18} />
                                <span>دانلود اکسل</span>
                            </button>
                        </div>

                        {/* Data Preview Table */}
                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1">
                             <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                                <table className="w-full text-sm text-right">
                                    <thead className="bg-gray-100 text-gray-700 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3">ID کلاستر</th>
                                            {clusteringAlgorithm.startsWith('hybrid') && <th className="px-4 py-3">نام کلاستر (Pillar)</th>}
                                            {clusteringAlgorithm.startsWith('hybrid') && <th className="px-4 py-3">نقش (Role)</th>}
                                            <th className="px-4 py-3">کلمه (Query)</th>
                                            <th className="px-4 py-3">Cluster Vol</th>
                                            <th className="px-4 py-3">تکرار در تایتل</th>
                                            <th className="px-4 py-3">رتبه ما</th>
                                            <th className="px-4 py-3 text-left" dir="ltr">Our URL</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {baseSerpData.slice(0, 100).map((row, idx) => {
                                             const queryVal = row[queryColumn] || row['top_queries'] || row['keyword'] || row['Query'];
                                             return (
                                                <tr key={idx} className="hover:bg-gray-50">
                                                    <td className="px-4 py-2 text-center bg-gray-50">{row['Cluster ID']}</td>
                                                    {clusteringAlgorithm.startsWith('hybrid') && <td className="px-4 py-2 text-center font-semibold text-indigo-700">{row['Cluster Name (Pillar)']}</td>}
                                                    {clusteringAlgorithm.startsWith('hybrid') && <td className="px-4 py-2 text-center text-xs">
                                                        <span className={row['Role'] === 'Pillar' ? 'bg-purple-100 text-purple-800 px-2 py-1 rounded' : 'text-gray-500'}>
                                                            {row['Role']}
                                                        </span>
                                                    </td>}
                                                    <td className="px-4 py-2">{queryVal}</td>
                                                    <td className="px-4 py-2 text-center text-xs text-gray-500">{row['Cluster Total Impression']?.toLocaleString()}</td>
                                                    <td className="px-4 py-2 text-center font-bold text-gray-700">{row['Exact Match in Title']}</td>
                                                    <td className="px-4 py-2 text-center">{row['Our Rank'] || '-'}</td>
                                                    <td className="px-4 py-2 text-left truncate max-w-xs" dir="ltr" title={row['Our URL']}>{row['Our URL']?.replace('https://', '')}</td>
                                                </tr>
                                             );
                                        })}
                                    </tbody>
                                </table>
                             </div>
                             {baseSerpData.length > 100 && (
                                 <div className="p-2 text-center text-xs text-gray-500 bg-gray-50 border-t">
                                     نمایش ۱۰۰ ردیف اول. (همه ستون‌های فایل اصلی در خروجی اکسل موجود هستند)
                                 </div>
                             )}
                        </div>

                        {/* Market Share Preview (CTR Based) */}
                        {marketShare && marketShare.length > 0 && (
                            <div className="flex-1">
                                <h4 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <BarChart3 size={20} className="text-blue-500"/>
                                    سهم بازار (Impression Share)
                                </h4>
                                <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                                    <table className="w-full text-sm text-right">
                                        <thead className="bg-gray-100 text-gray-600 border-b border-gray-200">
                                            <tr>
                                                <th className="px-4 py-3">رتبه</th>
                                                <th className="px-4 py-3">دامنه</th>
                                                <th className="px-4 py-3 text-center">ترافیک تخمینی</th>
                                                <th className="px-4 py-3 text-center">سهم (%)</th>
                                                <th className="px-4 py-3 text-left w-32">وضعیت</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {marketShare.slice(0, 5).map((item, idx) => (
                                                <tr key={idx} className="hover:bg-white transition-colors">
                                                    <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                                                    <td className="px-4 py-3 font-medium text-gray-800" dir="ltr">{item.Domain}</td>
                                                    <td className="px-4 py-3 text-center text-gray-600">{item['Est. Traffic']}</td>
                                                    <td className="px-4 py-3 text-center font-bold text-blue-600">{item['Share (%)']}%</td>
                                                    <td className="px-4 py-3">
                                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                                            <div 
                                                                className="bg-blue-500 h-2 rounded-full" 
                                                                style={{ width: `${Math.min(100, parseFloat(item['Share (%)']))}%` }}
                                                            ></div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center flex-1 text-gray-400 space-y-4">
                        <div className="bg-gray-50 p-6 rounded-full">
                            <PieChart size={48} className="opacity-20" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-lg font-medium text-gray-600">آماده برای شروع</h3>
                            <p className="text-sm mt-1">فایل اکسل کلمات را بارگذاری کنید تا بر اساس همپوشانی نتایج گوگل (SERP) خوشه‌بندی شوند.</p>
                        </div>
                    </div>
                )}
            </div>
       </div>

       <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
      `}</style>
    </div>
  );
}