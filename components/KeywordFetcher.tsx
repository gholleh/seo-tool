import React, { useState, useRef, useCallback, useMemo } from 'react';
import { 
  Search, 
  Download, 
  Copy, 
  Play, 
  Square, 
  Settings, 
  Database, 
  Layers, 
  Terminal,
  Trash2,
  XCircle,
  Sparkles,
  Filter,
  Loader2,
  Eraser,
  Eye,
  X,
  CheckSquare,
  MinusSquare,
  ArrowDown
} from 'lucide-react';
import { filterKeywordsBatch, generateSeedKeywords } from '../services/geminiService';

// --- Type Definitions ---
interface SuggestionResult {
  id: string;
  keyword: string;
  sourceSeed: string;
  layer: number;
  searchVolume?: number | string;
  isMizfa?: boolean;
  cpc?: number | string;
  competition?: number | string;
  difficulty?: number | string;
  translation?: string;
}

interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: string;
  previousState?: SuggestionResult[];
}

// --- Utils ---

const normalizeText = (text: string): string => {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ');
};

const generateCSV = (data: SuggestionResult[]) => {
  const header = ['Keyword,Source Seed,Layer'];
  const rows = data.map(item => `"${item.keyword}","${item.sourceSeed}",${item.layer}`);
  return [header, ...rows].join('\n');
};

export default function KeywordFetcher() {
  const [seeds, setSeeds] = useState<string>('');
  const [language, setLanguage] = useState<string>('fa');
  const [country, setCountry] = useState<string>('ir');
  const [depth, setDepth] = useState<number>(1);
  const [delay, setDelay] = useState<number>(1000); 
  const [concurrency, setConcurrency] = useState<number>(2); 
  const [useDeepAlphabet, setUseDeepAlphabet] = useState<boolean>(false);
  const [useMizfaSuggest, setUseMizfaSuggest] = useState<boolean>(false);
  const [useGoogleSuggest, setUseGoogleSuggest] = useState<boolean>(true);
  
  const [results, setResults] = useState<SuggestionResult[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 });

  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isAiFiltering, setIsAiFiltering] = useState<boolean>(false);
  
  const [aiSeedTopic, setAiSeedTopic] = useState<string>('');
  const [isGeneratingSeeds, setIsGeneratingSeeds] = useState<boolean>(false);
  const [aiFilterPendingReview, setAiFilterPendingReview] = useState<{ kept: Set<string>, removed: Set<string>, translations?: Record<string, string> } | null>(null);

  // --- New Manual Filter & Selection State ---
  const [filterText, setFilterText] = useState<string>('');
  const [isExclude, setIsExclude] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: 'volume', direction: 'asc' | 'desc' } | null>(null);
  const [targetLayerForDeepening, setTargetLayerForDeepening] = useState<number | 'max'>('max');

  const [mizfaBaseUrl, setMizfaBaseUrl] = useState<string>('https://api.mizfa.tools');
  const [mizfaApiKey, setMizfaApiKey] = useState<string>('');
  const [isFetchingVolume, setIsFetchingVolume] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const processedKeywordsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', previousState?: SuggestionResult[]) => {
    setLogs(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      message,
      type,
      timestamp: new Date().toLocaleTimeString(),
      previousState
    }, ...prev].slice(0, 100)); 
  }, []);

  const handleRestoreState = (prevState: SuggestionResult[]) => {
    setResults(prevState);
    processedKeywordsRef.current = new Set(prevState.map(r => r.keyword));
    setSelectedIds(new Set());
    addLog('وضعیت به مرحله قبل بازگردانده شد.', 'info');
  };

  // --- Filter Logic ---
  const filteredResults = useMemo(() => {
    let finalResults = results;

    if (filterText.trim()) {
      const term = normalizeText(filterText);
      finalResults = finalResults.filter(r => {
        const isMatch = normalizeText(r.keyword).includes(term);
        return isExclude ? !isMatch : isMatch;
      });
    }

    if (sortConfig) {
      finalResults = [...finalResults].sort((a, b) => {
        const volA = a.searchVolume !== undefined ? Number(a.searchVolume) : -1;
        const volB = b.searchVolume !== undefined ? Number(b.searchVolume) : -1;
        if (sortConfig.direction === 'asc') return volA - volB;
        return volB - volA;
      });
    }

    return finalResults;
  }, [results, filterText, isExclude, sortConfig]);

  // --- Sort Logic ---
  const handleSortByVolume = () => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig && sortConfig.direction === 'asc') {
      setSortConfig(null);
      return;
    }
    setSortConfig({ key: 'volume', direction });
  };

  const handleDeleteZeroVolume = () => {
    setResults(prev => {
      const newResults = prev.filter(r => r.searchVolume === undefined || r.searchVolume === null || Number(r.searchVolume) !== 0);
      processedKeywordsRef.current = new Set(newResults.map(r => r.keyword));
      const deletedCount = prev.length - newResults.length;
      if (deletedCount > 0) addLog(`${deletedCount} کلمه با سرچ والیوم صفر حذف شدند.`, 'success', prev);
      else addLog('کلمه‌ای با سرچ والیوم صفر یافت نشد.', 'info');
      return newResults;
    });
    setSelectedIds(new Set());
  };

  const handleContinueWithSelected = () => {
    let targetItems = filteredResults;
    if (selectedIds.size > 0) {
      targetItems = results.filter(r => selectedIds.has(r.id));
    }
    if (targetItems.length === 0) {
      addLog('کلمه‌ای برای انتقال یافت نشد.', 'warning');
      return;
    }
    const newSeeds = targetItems.map(t => t.keyword).join('\n');
    setSeeds(newSeeds);
    addLog(`${targetItems.length} کلمه به عنوان کلمات اولیه ثبت شدند. حالا می‌توانید عمق را افزایش داده و جستجو را ادامه دهید.`, 'success');
  };

  // --- Selection Logic ---
  const handleSelectAll = () => {
    const allVisibleSelected = filteredResults.length > 0 && filteredResults.every(r => selectedIds.has(r.id));
    if (allVisibleSelected) {
      // Deselect all visible
      const newSelected = new Set(selectedIds);
      filteredResults.forEach(r => newSelected.delete(r.id));
      setSelectedIds(newSelected);
    } else {
      // Select all visible
      const newSelected = new Set(selectedIds);
      filteredResults.forEach(r => newSelected.add(r.id));
      setSelectedIds(newSelected);
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    
    // Find keywords associated with selected ids
    const initialToRemoveList = results.filter(r => selectedIds.has(r.id)).map(r => r.keyword);
    
    const toRemove = new Set<string>(initialToRemoveList);
    const queue = [...initialToRemoveList];
    
    let head = 0;
    while(head < queue.length){
        const currentParent = queue[head];
        head++;

        const children = results.filter(r => r.sourceSeed === currentParent);
        
        children.forEach(child => {
            if (!toRemove.has(child.keyword)) {
                toRemove.add(child.keyword);
                queue.push(child.keyword);
            }
        });
    }

    setResults(prev => {
      const newResults = prev.filter(r => !toRemove.has(r.keyword));
      // Update the processed reference set
      processedKeywordsRef.current = new Set(newResults.map(r => r.keyword));
      addLog(`${toRemove.size} کلمه انتخابی (شامل زیرمجموعه ها) حذف شدند.`, 'success', prev);
      return newResults;
    });
    setSelectedIds(new Set());
  };


  const fetchSuggestions = async (query: string): Promise<string[]> => {
    let lastError: any = null;

    if (abortControllerRef.current?.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      // Use internal server API to bypass CORS proxy rate-limits
      const response = await fetch(`/api/suggest?hl=${language}&gl=${country}&q=${encodeURIComponent(query)}`, {
        signal: abortControllerRef.current?.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();

      if (Array.isArray(data) && Array.isArray(data[1])) {
          return data[1];
      }
      
      return [];

    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
    
    throw lastError || new Error('Fetch failed');
  };

  const fetchMizfaSuggestions = async (query: string): Promise<{keyword: string, searchVolume?: number, cpc?: number|string, competition?: number|string, difficulty?: number|string}[]> => {
    if (!mizfaApiKey) return [];
    
    if (abortControllerRef.current?.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
        const response = await fetch('/api/mizfa/proxy', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           signal: abortControllerRef.current?.signal,
           body: JSON.stringify({
              baseUrl: mizfaBaseUrl,
              endpoint: '/api/v1/keyword_planner/live',
              apiKey: mizfaApiKey,
              body: {
                 keyword: query,
                 language_code: language,
                 location_code: country
              }
           })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const resultData = await response.json();
        
        let list: any[] = [];
        if (resultData && resultData.code === 200 && resultData.data) {
           if (Array.isArray(resultData.data)) list = resultData.data;
           else if (resultData.data.keywords && Array.isArray(resultData.data.keywords)) list = resultData.data.keywords;
           else if (resultData.data.results && Array.isArray(resultData.data.results)) list = resultData.data.results;
           else if (resultData.data.data && Array.isArray(resultData.data.data)) list = resultData.data.data;
           else if (typeof resultData.data === 'object') {
              const possibleArrays = Object.values(resultData.data).filter(val => Array.isArray(val)) as any[][];
              if (possibleArrays.length > 0) {
                 list = possibleArrays.find(arr => arr.length > 0 && typeof arr[0] === 'object' && ('keyword' in arr[0] || 'search_volume' in arr[0])) || possibleArrays[0];
              }
           }
        }
        
        return list.map(item => ({
            keyword: item.keyword || item.phrase || '',
            searchVolume: item.search_volume !== undefined ? item.search_volume : item.volume,
            cpc: item.cpc !== undefined ? item.cpc : item.cost_per_click,
            competition: item.competition !== undefined ? item.competition : item.competition_index,
            difficulty: item.difficulty || item.keyword_difficulty
        })).filter(item => item.keyword !== '');

    } catch (e) {
        return [];
    }
  };

  interface QueueItem {
    query: string;
    uiSource: string;
    layer: number;
    skipMizfa?: boolean;
  }

  const processQueue = async (workingQueue: QueueItem[], targetDepth: number) => {
    let totalProcessedCount = 0;
    
    // Adaptive controls
    let adaptiveConcurrency = concurrency;
    let adaptiveDelay = delay;
    let consecutiveSuccesses = 0;
    const MAX_CONCURRENCY = 10;
    const MIN_CONCURRENCY = 1;
    const MAX_DELAY = 10000;
    const MIN_DELAY = 500;

    try {
      while (workingQueue.length > 0 && abortControllerRef.current) {
        
        const currentBatch = workingQueue.splice(0, adaptiveConcurrency);
        
        setProgress({ processed: totalProcessedCount, total: totalProcessedCount + workingQueue.length + currentBatch.length });

        let batchHasError = false;

        const batchPromises = currentBatch.map(async (item) => {
          if (item.layer >= targetDepth) return []; 

          try {
            let suggestionsFromGoogle: string[] = [];
            let suggestionsFromMizfa: {keyword: string, searchVolume?: number, isMizfa?: boolean, cpc?: number|string, competition?: number|string, difficulty?: number|string}[] = [];

            if (useGoogleSuggest) {
                try {
                    suggestionsFromGoogle = await fetchSuggestions(item.query);
                } catch (err: any) {
                    if (err.name !== 'AbortError') {
                       addLog(`خطا در گوگل ساجست برای: "${item.query}"`, 'warning');
                       batchHasError = true;
                    }
                }
            }

            if (useMizfaSuggest && mizfaApiKey && !item.skipMizfa) {
                try {
                    suggestionsFromMizfa = await fetchMizfaSuggestions(item.query);
                } catch (err: any) {
                    if (err.name !== 'AbortError') {
                       addLog(`خطا در ساجست‌های میزفا برای: "${item.query}"`, 'warning');
                       batchHasError = true;
                    }
                }
            } else if (useMizfaSuggest && !mizfaApiKey && !item.skipMizfa) {
                // Warning only logged once per run would be better, but doing it here locally is fine if limited
            }
            
            const newKeywords: QueueItem[] = [];
            
            // Map google suggestions to the common format
            const allSuggestions: {keyword: string, isMizfa: boolean, searchVolume?: number, cpc?: number|string, competition?: number|string, difficulty?: number|string}[] = [
                ...suggestionsFromGoogle.map(s => ({ keyword: s, isMizfa: false })),
                ...suggestionsFromMizfa.map(s => ({ ...s, isMizfa: true }))
            ];

            allSuggestions.forEach(suggObj => {
              const normalizedSugg = normalizeText(suggObj.keyword);
              if (!normalizedSugg) return;
              
              if (!processedKeywordsRef.current.has(normalizedSugg)) {
                processedKeywordsRef.current.add(normalizedSugg);
                
                const newResult: SuggestionResult = {
                  id: Math.random().toString(36).substr(2, 9),
                  keyword: normalizedSugg,
                  sourceSeed: item.uiSource,
                  layer: item.layer + 1,
                  searchVolume: suggObj.searchVolume,
                  isMizfa: suggObj.isMizfa,
                  cpc: suggObj.cpc,
                  competition: suggObj.competition,
                  difficulty: suggObj.difficulty
                };
                
                setResults(prev => [...prev, newResult]);
                
                if (item.layer + 1 < targetDepth) {
                  newKeywords.push({
                    query: normalizedSugg,
                    uiSource: normalizedSugg,
                    layer: item.layer + 1
                  });
                }
              } else {
                  // Update search volume or flag if we already had the keyword but didn't have these details
                  setResults(prev => prev.map(r => {
                      if (r.keyword === normalizedSugg) {
                          const updates: Partial<SuggestionResult> = {};
                          if (r.searchVolume === undefined && suggObj.searchVolume !== undefined) {
                              updates.searchVolume = suggObj.searchVolume;
                          }
                          if (!r.isMizfa && suggObj.isMizfa) {
                              updates.isMizfa = true;
                          }

                          if (Object.keys(updates).length > 0) {
                              return { ...r, ...updates };
                          }
                      }
                      return r;
                  }));
              }
            });
            return newKeywords;
          } catch (err: any) {
            batchHasError = true;
            return [];
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        // --- ADAPTIVE LOGIC ---
        if (batchHasError) {
             consecutiveSuccesses = 0;
             adaptiveDelay = Math.min(adaptiveDelay * 1.5, MAX_DELAY);
             adaptiveConcurrency = Math.max(Math.floor(adaptiveConcurrency / 2), MIN_CONCURRENCY);
             addLog(`کاهش سرعت پردازش به دلیل خطا (همزمان: ${adaptiveConcurrency}، تاخیر: ${Math.round(adaptiveDelay)}ms)`, 'info');
        } else {
             consecutiveSuccesses++;
             if (consecutiveSuccesses >= 3) {
                 if (adaptiveDelay > MIN_DELAY) {
                      adaptiveDelay = Math.max(adaptiveDelay * 0.8, MIN_DELAY);
                 } else if (adaptiveConcurrency < MAX_CONCURRENCY) {
                      adaptiveConcurrency = Math.min(adaptiveConcurrency + 1, MAX_CONCURRENCY);
                 }
                 consecutiveSuccesses = 0;
             }
        }
        
        // sync UI state for visual feedback
        setConcurrency(adaptiveConcurrency);
        setDelay(Math.round(adaptiveDelay));

        totalProcessedCount += currentBatch.length;

        batchResults.forEach(newItems => {
          workingQueue.push(...newItems);
        });

        if (workingQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
        }
      }
      
      if (abortControllerRef.current) {
        addLog('پردازش با موفقیت به پایان رسید.', 'success');
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        addLog('پردازش با خطای غیرمنتظره متوقف شد.', 'error');
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const startProcessing = async () => {
    if (!seeds.trim()) {
      addLog('لطفا کلمات کلیدی اولیه را وارد کنید.', 'error');
      return;
    }

    const knownVolumes = new Map<string, number | string>();
    const knownSources = new Map<string, boolean>();
    results.forEach(r => {
        if (r.searchVolume !== undefined && r.searchVolume !== null) {
            knownVolumes.set(r.keyword, r.searchVolume);
        }
        if (r.isMizfa) {
            knownSources.set(r.keyword, true);
        }
    });

    setIsProcessing(true);
    setResults([]);
    setLogs([]);
    processedKeywordsRef.current = new Set();
    abortControllerRef.current = new AbortController();

    const seedList = seeds.split('\n').map(s => normalizeText(s)).filter(s => s.length > 0);
    
    const initialResults: SuggestionResult[] = seedList.map(s => ({
      id: Math.random().toString(36).substr(2, 9),
      keyword: s,
      sourceSeed: '-',
      layer: 0,
      searchVolume: knownVolumes.get(s),
      isMizfa: knownSources.get(s)
    }));

    setResults(initialResults);

    let queue: QueueItem[] = [];
    seedList.forEach(s => {
       queue.push({ query: s, uiSource: s, layer: 0 });
       
       if (useDeepAlphabet) {
          const prefixes = ['خرید', 'فروش', 'قیمت', 'بهترین', 'مقایسه', 'از', 'با', 'در', 'به', 'برای', 'فرق', 'اگر', 'آموزش', 'روش', 'کدام'];
          const alphabet = ['ا', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];
          
          prefixes.forEach(p => {
             queue.push({ query: `${p} ${s}`, uiSource: s, layer: 0, skipMizfa: true });
             queue.push({ query: `${s} ${p}`, uiSource: s, layer: 0, skipMizfa: true });
          });
          alphabet.forEach(a => {
             queue.push({ query: `${s} ${a}`, uiSource: s, layer: 0, skipMizfa: true });
             queue.push({ query: `${a} ${s}`, uiSource: s, layer: 0, skipMizfa: true });
          });
       }
    });

    seedList.forEach(s => processedKeywordsRef.current.add(s));

    addLog(`شروع پردازش با ${queue.length} کوئری صف‌شده...`, 'info');

    await processQueue(queue, depth);
  };

  const handleContinueProcessing = async () => {
      let targetItems = filteredResults;
      if (selectedIds.size > 0) {
          targetItems = results.filter(r => selectedIds.has(r.id));
      } else {
          if (targetLayerForDeepening === 'max') {
              let maxLayer = 0;
              targetItems.forEach(r => {
                  if (r.layer > maxLayer) maxLayer = r.layer;
              });
              if (maxLayer > 0 || targetItems.length > 0) {
                  targetItems = targetItems.filter(r => r.layer === maxLayer);
              }
          } else {
              targetItems = targetItems.filter(r => r.layer === targetLayerForDeepening);
          }
      }

      if (targetItems.length === 0) {
          addLog('هیچ کلمه‌ای در لایه انتخاب شده برای ادامه یافت نشد.', 'warning');
          return;
      }
      
      const nextLayerDest = targetItems[0].layer + 1;
      if (depth < nextLayerDest) {
         setDepth(nextLayerDest);
      }

      setIsProcessing(true);
      abortControllerRef.current = new AbortController();

      let queue: QueueItem[] = [];
      targetItems.forEach(item => {
         queue.push({ query: item.keyword, uiSource: item.keyword, layer: item.layer });
         
         if (useDeepAlphabet) {
            const prefixes = ['خرید', 'فروش', 'قیمت', 'بهترین', 'مقایسه', 'از', 'با', 'در', 'به', 'برای', 'فرق', 'اگر', 'آموزش', 'روش', 'کدام'];
            const alphabet = ['ا', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];
            
            prefixes.forEach(p => {
               queue.push({ query: `${p} ${item.keyword}`, uiSource: item.keyword, layer: item.layer, skipMizfa: true });
               queue.push({ query: `${item.keyword} ${p}`, uiSource: item.keyword, layer: item.layer, skipMizfa: true });
            });
            alphabet.forEach(a => {
               queue.push({ query: `${item.keyword} ${a}`, uiSource: item.keyword, layer: item.layer, skipMizfa: true });
               queue.push({ query: `${a} ${item.keyword}`, uiSource: item.keyword, layer: item.layer, skipMizfa: true });
            });
         }
      });

      addLog(`ادامه تعمیق برای ${targetItems.length} کلمه از لایه ${targetItems[0].layer}...`, 'info');
      
      await processQueue(queue, nextLayerDest);
  };

  const stopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsProcessing(false);
      addLog('پردازش توسط کاربر متوقف شد.', 'warning');
    }
  };

  const handleAiFilter = async () => {
    if (results.length === 0) {
      addLog('هیچ کلمه‌ای برای تحلیل وجود ندارد.', 'warning');
      return;
    }
    if (!aiPrompt.trim()) {
      addLog('لطفا دستور فیلتر (Prompt) را وارد کنید.', 'error');
      return;
    }

    if (!process.env.API_KEY) {
      addLog('API Key یافت نشد. لطفا تنظیمات برنامه را بررسی کنید.', 'error');
      return;
    }

    setIsAiFiltering(true);
    addLog('شروع تحلیل هوشمند کلمات با هوش مصنوعی...', 'info');

    try {
      const CHUNK_SIZE = 75;
      const allKeywords = results.map(r => r.keyword);
      const chunks = [];
      
      for (let i = 0; i < allKeywords.length; i += CHUNK_SIZE) {
        chunks.push(allKeywords.slice(i, i + CHUNK_SIZE));
      }

      let keptKeywordsSet = new Set<string>();
      let allTranslations: Record<string, string> = {};
      
      const processChunkWithRetry = async (chunk: string[], batchIndex: number, attempt = 1): Promise<{ keptKeywords: string[], translations?: Record<string, string> }> => {
          try {
              let prompt = aiPrompt;
              if (language !== 'fa') {
                prompt += `\nNote: The keywords are in ${language}. Please provide Persian translations for all keywords.`;
              }
              return await filterKeywordsBatch(chunk, prompt);
          } catch (e: any) {
              if (attempt <= 3) {
                  const delayTime = 2000 * attempt;
                  addLog(`خطا در دسته ${batchIndex + 1}. تلاش مجدد (${attempt}/3) تا ${delayTime/1000} ثانیه دیگر...`, 'warning');
                  await new Promise(r => setTimeout(r, delayTime));
                  return processChunkWithRetry(chunk, batchIndex, attempt + 1);
              }
              throw e;
          }
      };

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        addLog(`در حال تحلیل دسته ${i + 1} از ${chunks.length} (${chunk.length} کلمه)...`, 'info');

        try {
          const res = await processChunkWithRetry(chunk, i);
          
          res.keptKeywords.forEach(k => keptKeywordsSet.add(k));
          if (res.translations) {
            allTranslations = { ...allTranslations, ...res.translations };
          }
          
          if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }

        } catch (err) {
          console.error(err);
          addLog(`خطا در تحلیل دسته ${i + 1} پس از ۳ تلاش. این دسته بدون تغییر باقی می‌ماند.`, 'error');
          chunk.forEach(k => keptKeywordsSet.add(k));
        }
      }

      const initialCount = results.length;
      const finalCount = keptKeywordsSet.size;
      const removedCount = initialCount - finalCount;

      const removedSet = new Set(allKeywords.filter(k => !keptKeywordsSet.has(k)));
      setAiFilterPendingReview({ kept: keptKeywordsSet, removed: removedSet, translations: allTranslations });

      addLog(`پایان تحلیل. ${removedCount} کلمه برای حذف و ${finalCount} کلمه برای نگهداری پیدا شد. در انتظار تایید...`, 'info');

    } catch (error) {
      addLog('خطای کلی در فرآیند هوش مصنوعی.', 'error');
      console.error(error);
    } finally {
      setIsAiFiltering(false);
    }
  };

  const confirmAiFilter = () => {
    if (!aiFilterPendingReview) return;
    
    // Find all keywords to remove and cascade to children
    const toRemove = new Set<string>();
    const queue = Array.from(aiFilterPendingReview.removed);
    queue.forEach(k => toRemove.add(k));

    let head = 0;
    while(head < queue.length){
        const currentParent = queue[head];
        head++;

        const children = results.filter(r => r.sourceSeed === currentParent);
        
        children.forEach(child => {
            if (!toRemove.has(child.keyword)) {
                toRemove.add(child.keyword);
                queue.push(child.keyword);
            }
        });
    }

    const newResults = results.filter(r => !toRemove.has(r.keyword)).map(r => {
        if (aiFilterPendingReview.translations && aiFilterPendingReview.translations[r.keyword]) {
            return { ...r, translation: aiFilterPendingReview.translations[r.keyword] };
        }
        return r;
    });
    addLog(`فیلتر اعمال شد. ${toRemove.size} کلمه (شامل زیردسته ها) حذف گردید.`, 'success', results);
    setResults(newResults);
    processedKeywordsRef.current = new Set(newResults.map(r => r.keyword));
    setAiFilterPendingReview(null);
  };

  const cancelAiFilter = () => {
    setAiFilterPendingReview(null);
    addLog('فیلتر هوش مصنوعی لغو شد.', 'info');
  };

  const toggleRestoreKeyword = (keyword: string) => {
    if (!aiFilterPendingReview) return;
    
    setAiFilterPendingReview(prev => {
      if (!prev) return prev;
      const newRemoved = new Set(prev.removed);
      const newKept = new Set(prev.kept);
      
      if (newRemoved.has(keyword)) {
        newRemoved.delete(keyword);
        newKept.add(keyword);
      } else {
        newKept.delete(keyword);
        newRemoved.add(keyword);
      }
      
      return { kept: newKept, removed: newRemoved };
    });
  };

  const handleGenerateAiSeeds = async () => {
    if (!aiSeedTopic.trim()) {
      addLog('لطفا موضوع برای تولید کلمات کلیدی را وارد کنید.', 'error');
      return;
    }
    setIsGeneratingSeeds(true);
    try {
      const generated = await generateSeedKeywords(aiSeedTopic, 15);
      if (generated && generated.length > 0) {
        const newSeeds = generated.join('\n');
        setSeeds(prev => prev ? `${prev}\n${newSeeds}` : newSeeds);
        addLog(`${generated.length} کلمه کلیدی با موفقیت تولید شد.`, 'success');
        setAiSeedTopic('');
      } else {
        addLog('هوش مصنوعی کلمه‌ای تولید نکرد.', 'warning');
      }
    } catch (error) {
      addLog('خطا در تولید کلمات کلیدی با هوش مصنوعی.', 'error');
    } finally {
      setIsGeneratingSeeds(false);
    }
  };

  const handleExport = () => {
    let itemsToExport = results;
    if (selectedIds.size > 0) {
      // Export only selected if there's any selection
      const allDisplayItemsMap = new Map(results.map(r => [r.id, r]));
      itemsToExport = filteredResults.filter(r => selectedIds.has(r.id));
      if (itemsToExport.length === 0) {
          itemsToExport = results.filter(r => selectedIds.has(r.id));
      }
    }
    
    let filename = `deep_suggest_${new Date().toISOString().slice(0,10)}.csv`;
    if (itemsToExport.length > 0) {
        const firstKeyword = itemsToExport[0].keyword.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').trim().replace(/\s+/g, '_');
        if (firstKeyword) {
            filename = `deep_suggest_${firstKeyword}.csv`;
        }
    }
    
    const headerColumns = ['Keyword', 'Source Seed', 'Layer', 'Search Volume', 'CPC', 'Competition', 'Difficulty'];
    if (language !== 'fa') {
      headerColumns.push('Translation');
    }
    const header = [headerColumns.join(',')];
    const rows = itemsToExport.map(item => {
      const baseRow = `"${item.keyword}","${item.sourceSeed}",${item.layer},${item.searchVolume ?? ''},${item.cpc ?? ''},${item.competition ?? ''},${item.difficulty ?? ''}`;
      if (language !== 'fa') {
        return `${baseRow},"${item.translation || ''}"`;
      }
      return baseRow;
    });
    const csvContent = [header, ...rows].join('\n');
    
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog('فایل CSV دانلود شد.', 'success');
  };

  const handleCopy = () => {
    let itemsToCopy = results;
    if (selectedIds.size > 0) {
      itemsToCopy = results.filter(r => selectedIds.has(r.id));
    }
    const text = itemsToCopy.map(r => r.keyword).join('\n');
    
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        addLog(`${results.length} کلمه کلیدی در کلیپ‌بورد کپی شد.`, 'success');
      } else {
        addLog('کپی ناموفق بود. لطفا دستی کپی کنید.', 'error');
      }
    } catch (err) {
      console.error('Copy failed', err);
      addLog('خطا در کپی کردن متن.', 'error');
    }
    
    document.body.removeChild(textArea);
  };

  const handleClear = () => {
    setResults([]);
    setLogs([]);
    setSelectedIds(new Set());
    setFilterText('');
    processedKeywordsRef.current = new Set();
    setProgress({ processed: 0, total: 0 });
  };

  const handleClearCache = () => {
    processedKeywordsRef.current = new Set(results.map(r => r.keyword));
    addLog('کش کلمات (کلمات پردازش شده) پاک شد. کلماتی که قبلا استخراج و حذف شده بودند، حالا دوباره قابل استخراج هستند.', 'success');
  };

  const handleDeleteItem = (targetKeyword: string) => {
    const toRemove = new Set<string>([targetKeyword]);
    const queue = [targetKeyword];
    
    let head = 0;
    while(head < queue.length){
        const currentParent = queue[head];
        head++;

        const children = results.filter(r => r.sourceSeed === currentParent);
        
        children.forEach(child => {
            if (!toRemove.has(child.keyword)) {
                toRemove.add(child.keyword);
                queue.push(child.keyword);
            }
        });
    }

    setResults(prev => {
      addLog(`کلمه "${targetKeyword}" و ${toRemove.size - 1} زیرمجموعه آن حذف شدند.`, 'warning', prev);
      return prev.filter(r => !toRemove.has(r.keyword));
    });
    
    toRemove.forEach(k => processedKeywordsRef.current.delete(k));
  };

  const handleFetchSearchVolume = async () => {
    let targetItems = filteredResults;
    if (selectedIds.size > 0) {
      targetItems = results.filter(r => selectedIds.has(r.id));
    }
    
    // Filter out keywords that already have search volume
    targetItems = targetItems.filter(item => item.searchVolume === undefined || item.searchVolume === null);
    
    if (targetItems.length === 0) {
       addLog('همه موارد انتخاب شده در حال حاضر سرچ والیوم دارند یا هیچ موردی انتخاب نشده است.', 'warning');
       return;
    }

    if (!mizfaApiKey.trim()) {
       addLog('لطفاً ابتدا API Key ابزار میزفاتولز را وارد کنید.', 'error');
       return;
    }

    setIsFetchingVolume(true);
    addLog(`درخواست دریافت سرچ والیوم برای ${targetItems.length} کلمه (کلمات بدون سرچ والیوم)...`, 'info');

    const keywords = targetItems.map(item => item.keyword);
    // API limitation: max 100 keywords per request
    const CHUNK_SIZE = 100;
    const chunks = [];
    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
       chunks.push(keywords.slice(i, i + CHUNK_SIZE));
    }

    let successCount = 0;
    const statsMap = new Map<string, {searchVolume: number, cpc?: number|string, competition?: number|string, difficulty?: number|string}>();

    try {
       for (let i = 0; i < chunks.length; i++) {
           const chunk = chunks[i];
           addLog(`در حال دریافت دسته ${i + 1} از ${chunks.length} (${chunk.length} کلمه)...`, 'info');
           
           let retries = 3;
           let success = false;
           
           while (retries > 0 && !success) {
               try {
                   const response = await fetch('/api/mizfa/proxy', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                          baseUrl: mizfaBaseUrl,
                          endpoint: '/api/v1/search_volume/live',
                          apiKey: mizfaApiKey,
                          body: {
                             language_code: language,
                             location_code: country,
                             keywords: chunk
                          }
                      })
                   });
        
                   if (!response.ok) {
                      const errData = await response.json().catch(() => ({}));
                      throw new Error(errData.msg || `خطای HTTP: ${response.status}`);
                   }
        
                   const resultData = await response.json();
                   
                   if (resultData && resultData.code === 200) {
                       addLog(`پاسخ موفق دریافت شد. تعداد کلیک/کلمات: ${resultData.data?.num_of_keywords || 'نامشخص'}`, 'info');
                       
                       let list: any[] = [];
                       if (Array.isArray(resultData.data)) {
                          list = resultData.data;
                       } else if (resultData.data && Array.isArray(resultData.data.keywords)) {
                          list = resultData.data.keywords;
                       } else if (resultData.data && Array.isArray(resultData.data.results)) {
                          list = resultData.data.results;
                       } else if (resultData.data && Array.isArray(resultData.data.data)) {
                          list = resultData.data.data;
                       } else if (resultData.data && typeof resultData.data === 'object') {
                          const possibleArrays = Object.values(resultData.data).filter(val => Array.isArray(val)) as any[][];
                          if (possibleArrays.length > 0) {
                              list = possibleArrays.find(arr => arr.length > 0 && typeof arr[0] === 'object' && ('keyword' in arr[0] || 'search_volume' in arr[0])) || possibleArrays[0];
                          }
                       }
                       
                       // Initially, set everything in chunk to 0 (default fallback)
                       chunk.forEach(kw => statsMap.set(kw, {searchVolume: 0}));

                       let foundCount = 0;
                       list.forEach((item: any) => {
                           const kw = item.keyword || item.phrase;
                           let vol = item.search_volume !== undefined ? item.search_volume : item.volume;
                           
                           if (vol === null || vol === undefined || vol === '') {
                               vol = 0;
                           }

                           if (kw !== undefined) {
                               statsMap.set(kw, {
                                   searchVolume: Number(vol),
                                   cpc: item.cpc !== undefined ? item.cpc : item.cost_per_click,
                                   competition: item.competition !== undefined ? item.competition : item.competition_index,
                                   difficulty: item.difficulty || item.keyword_difficulty
                               });
                               foundCount++;
                           }
                       });
                       
                       // A 200 response means success. Words not in response have 0 volume.
                       successCount += chunk.length;
                       success = true;
                   } else {
                       throw new Error(`خطا از سمت API: ${resultData?.msg || 'نامشخص'}`);
                   }
               } catch (error: any) {
                   retries--;
                   if (retries > 0) {
                       addLog(`خطا در دریافت دسته ${i + 1}: ${error.message}. در حال تلاش مجدد...`, 'warning');
                       await new Promise(r => setTimeout(r, 2000));
                   } else {
                       addLog(`دریافت دسته ${i + 1} با خطا مواجه شد: ${error.message} (از این دسته عبور میکنیم)`, 'error');
                   }
               }
           }
           
           if (i < chunks.length - 1) {
              await new Promise(r => setTimeout(r, 1000));
           }
       }

       if (statsMap.size > 0) {
           setResults(prev => prev.map(r => {
               if (statsMap.has(r.keyword)) {
                   const stats = statsMap.get(r.keyword)!;
                   return {
                       ...r,
                       searchVolume: stats.searchVolume,
                       cpc: stats.cpc,
                       competition: stats.competition,
                       difficulty: stats.difficulty
                   };
               }
               return r;
           }));
           addLog(`اطلاعات برای ${statsMap.size} کلمه با موفقیت ثبت شد.`, 'success');
       } else {
           addLog('هیچ داده سرچ والیومی در این عملیات دریافت نشد.', 'warning');
       }
       
    } catch (error: any) {
       addLog(`خطا در اجرای فرآیند کلی: ${error.message}`, 'error');
    } finally {
       setIsFetchingVolume(false);
    }
  };

  const availableLayers = Array.from(new Set(results.map(r => r.layer))).sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Left Column: Configuration (4 cols) */}
      <div className="lg:col-span-4 space-y-6">
        
        {/* Input Panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Database size={20} className="text-blue-500" />
            ورودی‌ها
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">کلمات کلیدی اولیه (Seed)</label>
              
              <div className="mb-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <label className="block text-xs font-semibold text-blue-800 mb-2">تولید کلمات Seed با هوش مصنوعی</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="مثال: آموزش بورس، خرید لپ تاپ..."
                    value={aiSeedTopic}
                    onChange={(e) => setAiSeedTopic(e.target.value)}
                    disabled={isGeneratingSeeds || isProcessing}
                    className="flex-1 p-2 text-sm border border-blue-200 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleGenerateAiSeeds}
                    disabled={isGeneratingSeeds || isProcessing || !aiSeedTopic.trim()}
                    className="px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center min-w-[100px]"
                  >
                    {isGeneratingSeeds ? <Loader2 size={16} className="animate-spin" /> : 'تولید (AI)'}
                  </button>
                </div>
              </div>

              <textarea
                className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                placeholder="هر خط یک کلمه...&#10;خرید موبایل&#10;آموزش سئو"
                value={seeds}
                onChange={(e) => setSeeds(e.target.value)}
                disabled={isProcessing || isAiFiltering}
              ></textarea>
              <p className="text-xs text-gray-500 mt-1 text-left ltr">
                {seeds.split('\n').filter(s => s.trim()).length} Seed Keywords
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">زبان (hl)</label>
                <select 
                  value={language} 
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                  disabled={isProcessing || isAiFiltering}
                >
                  <option value="fa">فارسی (fa)</option>
                  <option value="en">English (en)</option>
                  <option value="ar">Arabic (ar)</option>
                  <option value="tr">Turkish (tr)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">منطقه (gl)</label>
                <select 
                  value={country} 
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                  disabled={isProcessing || isAiFiltering}
                >
                  <option value="ir">ایران (ir)</option>
                  <option value="iq">عراق (iq)</option>
                  <option value="ae">UAE (ae)</option>
                  <option value="tr">Turkey (tr)</option>
                  <option value="sa">Saudi Arabia (sa)</option>
                  <option value="qa">Qatar (qa)</option>
                  <option value="om">Oman (om)</option>
                  <option value="kw">Kuwait (kw)</option>
                  <option value="bh">Bahrain (bh)</option>
                  <option value="us">United States (us)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Removed Old Manual Filter Panel */}

        {/* AI Filter Panel */}
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-sm border border-indigo-100 p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-indigo-900">
            <Sparkles size={20} className="text-indigo-600" />
            فیلتر هوشمند (AI)
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-indigo-800 mb-1">چه کلماتی را نگه دارم/حذف کنم؟</label>
              <textarea 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                disabled={isProcessing || isAiFiltering}
                placeholder="مثال: کلمات مربوط به 'رایگان' یا 'کرک' را حذف کن. فقط کلمات خرید آنلاین را نگه دار."
                className="w-full h-24 p-3 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm resize-none bg-white"
              />
            </div>
            <button
              onClick={handleAiFilter}
              disabled={isProcessing || isAiFiltering || results.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isAiFiltering ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>در حال تحلیل...</span>
                </>
              ) : (
                <>
                  <Filter size={18} />
                  <span>اعمال فیلتر روی نتایج</span>
                </>
              )}
            </button>
            <p className="text-xs text-indigo-400 leading-relaxed">
              این ابزار لیست نتایج فعلی را به Gemini می‌فرستد و بر اساس دستور شما آن را پالایش می‌کند. (تجزیه به بسته‌های کوچک‌تر جهت پایداری)
            </p>

            {aiFilterPendingReview && (
              <div className="mt-4 p-4 bg-white border border-indigo-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-bold text-indigo-900 mb-2">نتیجه بررسی هوش مصنوعی:</h3>
                <div className="flex justify-between text-xs mb-3 text-gray-600">
                   <span>مورد تایید: <strong className="text-green-600">{aiFilterPendingReview.kept.size}</strong></span>
                   <span>پیشنهاد حذف: <strong className="text-red-500">{aiFilterPendingReview.removed.size}</strong></span>
                </div>
                
                {aiFilterPendingReview.removed.size > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        کلمات آماده حذف <span className="text-[10px] text-gray-500 font-normal">(برای بازگردانی کلیک کنید)</span>
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(Array.from(aiFilterPendingReview.removed).join('\n'));
                          addLog('کلمات حذفی کپی شدند', 'success');
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-white px-2 py-1 rounded shadow-sm border border-indigo-100"
                        title="کپی کردن کلمات لیست حذف"
                      >
                        <Copy size={12} />
                        کپی همه
                      </button>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded p-2 max-h-48 overflow-y-auto text-xs text-red-800 flex flex-col gap-1.5">
                       {Array.from(aiFilterPendingReview.removed).map(k => (
                         <button 
                           key={k} 
                           onClick={() => toggleRestoreKeyword(k)}
                           title="کلیک برای بازگردانی به لیست اصلی"
                           className="bg-white border border-red-200 px-3 py-2 rounded shadow-sm hover:bg-green-50 hover:border-green-300 hover:text-green-700 hover:line-through transition-all flex items-center cursor-pointer text-xs text-right w-full"
                         >
                           {k}
                         </button>
                       ))}
                    </div>
                  </div>
                )}

                {aiFilterPendingReview.kept.size > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        کلمات تایید شده <span className="text-[10px] text-gray-500 font-normal">(برای حذف کلیک کنید)</span>
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(Array.from(aiFilterPendingReview.kept).join('\n'));
                          addLog('کلمات تایید شده کپی شدند', 'success');
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-white px-2 py-1 rounded shadow-sm border border-indigo-100"
                        title="کپی کردن کلمات لیست تایید شده"
                      >
                        <Copy size={12} />
                        کپی همه
                      </button>
                    </div>
                    <div className="bg-green-50 border border-green-100 rounded p-2 max-h-48 overflow-y-auto text-xs text-green-800 flex flex-col gap-1.5">
                       {Array.from(aiFilterPendingReview.kept).map(k => (
                         <button 
                           key={k} 
                           onClick={() => toggleRestoreKeyword(k)}
                           title="کلیک برای انتقال به لیست حذف"
                           className="bg-white border border-green-200 px-3 py-2 rounded shadow-sm hover:bg-red-50 hover:border-red-300 hover:text-red-700 hover:line-through transition-all flex items-center cursor-pointer text-xs text-right w-full"
                         >
                           {k}
                         </button>
                       ))}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                   <button 
                     onClick={confirmAiFilter}
                     className="flex-1 bg-green-600 text-white text-xs py-2 rounded font-medium hover:bg-green-700 transition"
                   >
                     تایید و حذف کلمات
                   </button>
                   <button 
                     onClick={cancelAiFilter}
                     className="flex-1 bg-gray-200 text-gray-700 text-xs py-2 rounded font-medium hover:bg-gray-300 transition"
                   >
                     لغو عملیات
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Settings Panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings size={20} className="text-gray-500" />
            تنظیمات پیشرفته
          </h2>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">عمق جستجو (Depth)</label>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">لایه {depth}</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="3" 
                step="1"
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value))}
                disabled={isProcessing || isAiFiltering}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-sm font-medium text-gray-700">تعداد درخواست همزمان (خودکار)</span>
              <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full">{concurrency} درخواست</span>
            </div>

            <div className="flex items-center gap-2 mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <input
                type="checkbox"
                id="useDeepAlphabet"
                checked={useDeepAlphabet}
                onChange={(e) => setUseDeepAlphabet(e.target.checked)}
                disabled={isProcessing || isAiFiltering}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="useDeepAlphabet" className="text-sm font-medium text-gray-700 select-none cursor-pointer">
                جستجوی عمیق با حروف الفبا و پیشوند/پسوند
              </label>
            </div>

            <div className="flex flex-col gap-2 mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useGoogleSuggest"
                  checked={useGoogleSuggest}
                  onChange={(e) => setUseGoogleSuggest(e.target.checked)}
                  disabled={isProcessing || isAiFiltering}
                  className="w-4 h-4 text-blue-600 bg-white border-blue-300 rounded focus:ring-blue-500 disabled:opacity-50"
                />
                <label htmlFor="useGoogleSuggest" className="text-sm font-medium text-blue-800 select-none cursor-pointer">
                  دریافت پیشنهادات گوگل
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <input
                type="checkbox"
                id="useMizfaSuggest"
                checked={useMizfaSuggest}
                onChange={(e) => setUseMizfaSuggest(e.target.checked)}
                disabled={isProcessing || isAiFiltering || !mizfaApiKey}
                className="w-4 h-4 text-amber-600 bg-white border-amber-300 rounded focus:ring-amber-500 disabled:opacity-50"
              />
              <label htmlFor="useMizfaSuggest" className={`text-sm font-medium select-none cursor-pointer ${mizfaApiKey ? 'text-amber-800' : 'text-gray-400'}`}>
                تلفیق با پیشنهادات سرچ والیوم دار میزفا (نیاز به API Key دارد)
              </label>
            </div>

            <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200 mt-2">
              <span className="text-sm font-medium text-gray-700">تاخیر درخواست (خودکار)</span>
              <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full">{delay} میلی‌ثانیه</span>
            </div>

             {/* Action Buttons inside Settings for Mobile/Compact Layout */}
             <div className="pt-4 flex flex-col gap-2">
                {isProcessing ? (
                <button 
                    onClick={stopProcessing}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-md hover:bg-red-100 transition-colors"
                >
                    <Square size={18} fill="currentColor" />
                    <span>توقف استخراج</span>
                </button>
                ) : (
                <button 
                    onClick={startProcessing}
                    disabled={isAiFiltering || isFetchingVolume}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Play size={18} fill="currentColor" />
                    <span>شروع استخراج</span>
                </button>
                )}
                
                <div className="flex flex-col gap-1 mt-2">
                   <label className="text-xs font-medium text-gray-700">لایه هدف برای تعمیق (در صورت عدم انتخاب کلمات):</label>
                   <select 
                      value={targetLayerForDeepening} 
                      onChange={(e) => setTargetLayerForDeepening(e.target.value === 'max' ? 'max' : Number(e.target.value))}
                      className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 bg-white"
                   >
                      <option value="max">عمیق ترین لایه موجود (خودکار)</option>
                      {availableLayers.map(l => (
                         <option key={l} value={l}>لایه {l}</option>
                      ))}
                   </select>
                </div>
                
                <button
                    onClick={handleContinueProcessing}
                    disabled={isProcessing || isAiFiltering || isFetchingVolume || results.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ArrowDown size={18} />
                    <span>ادامه تعمیق لیستی</span>
                </button>
             </div>
          </div>
        </div>

        {/* MizfaTools Panel */}
        <div className="bg-amber-50 rounded-xl shadow-sm border border-amber-200 p-5">
           <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-amber-900">
             <Database size={20} className="text-amber-600" />
             آمار جستجو (Mizfa Tools)
           </h2>
           <div className="space-y-4">
               <div>
                  <label className="block text-sm font-medium text-amber-800 mb-1">Base URL (پایه)</label>
                  <input
                     type="text"
                     value={mizfaBaseUrl}
                     onChange={(e) => setMizfaBaseUrl(e.target.value)}
                     disabled={isFetchingVolume}
                     placeholder="https://api.mizfa.tools"
                     className="w-full p-2 border border-amber-300 rounded-md text-sm rtl text-left focus:ring-2 focus:ring-amber-500"
                  />
               </div>
               <div>
                  <label className="block text-sm font-medium text-amber-800 mb-1">API Key</label>
                  <input
                     type="password"
                     value={mizfaApiKey}
                     onChange={(e) => setMizfaApiKey(e.target.value)}
                     disabled={isFetchingVolume}
                     placeholder="X-API-Key..."
                     className="w-full p-2 border border-amber-300 rounded-md text-sm ltr text-left focus:ring-2 focus:ring-amber-500"
                  />
               </div>
               <button
                  onClick={handleFetchSearchVolume}
                  disabled={isFetchingVolume || isProcessing || results.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  {isFetchingVolume ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>در حال دریافت...</span>
                    </>
                  ) : (
                    <>
                      <Download size={18} />
                      <span>دریافت سرچ والیوم</span>
                    </>
                  )}
               </button>
               <p className="text-xs text-amber-700 leading-relaxed">
                   سرچ والیوم برای موارد کلمات نمایش داده شده (یا انتخاب شده) بصورت دسته‌های ۱۰۰ تایی دریافت می‌شود.
               </p>
           </div>
        </div>

        {/* Log Panel */}
        <div className="bg-gray-900 rounded-xl shadow-sm border border-gray-800 p-4 h-64 flex flex-col">
            <h2 className="text-xs font-mono text-gray-400 mb-2 flex items-center gap-2 border-b border-gray-700 pb-2">
            <Terminal size={14} />
            System Logs
        </h2>
        <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 custom-scrollbar">
            {logs.length === 0 && <span className="text-gray-600 italic">آماده برای شروع...</span>}
            {logs.map((log) => (
            <div key={log.id} className={`flex gap-2 items-start ${
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'success' ? 'text-green-400' : 
                log.type === 'warning' ? 'text-yellow-400' : 'text-gray-300'
            }`}>
                <span className="text-gray-600 mt-0.5 whitespace-nowrap">[{log.timestamp}]</span>
                <div className="flex-1 flex flex-wrap gap-2 items-center">
                   <span>{log.message}</span>
                   {log.previousState && (
                     <button
                        onClick={() => handleRestoreState(log.previousState!)}
                        className="text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-0.5 rounded transition-colors border border-gray-600"
                     >
                       بازگردانی (Undo)
                     </button>
                   )}
                </div>
            </div>
            ))}
        </div>
        </div>

      </div>

      {/* Right Column: Results (8 cols) */}
      <div className="lg:col-span-8 flex flex-col h-full space-y-6">
        
        {/* Stats Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 justify-between items-center">
            <div className="flex gap-6">
            <div className="flex flex-col">
                <span className="text-xs text-gray-500">کلمات پیدا شده</span>
                <span className="text-2xl font-bold text-blue-600">{results.length}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs text-gray-500">وضعیت</span>
                <span className={`text-sm font-medium mt-1 ${isProcessing ? 'text-amber-500 animate-pulse' : isAiFiltering ? 'text-indigo-500 animate-pulse' : 'text-green-600'}`}>
                {isProcessing ? 'در حال استخراج...' : isAiFiltering ? 'در حال تحلیل AI...' : 'آماده'}
                </span>
            </div>
            {isProcessing && (
                <div className="flex flex-col w-32">
                <span className="text-xs text-gray-500 mb-1">پیشرفت استخراج</span>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${Math.min(100, (progress.processed / Math.max(progress.total, 1)) * 100)}%` }}
                    ></div>
                </div>
                </div>
            )}
            </div>

            <div className="flex gap-2">
            <button 
                onClick={handleClearCache}
                className="p-2 text-gray-500 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                title="پاک کردن کش کلمات (برای استخراج مجدد کلماتی که قبلاً حذف کرده‌اید)"
            >
                <Eraser size={20} />
            </button>
            <button 
                onClick={handleClear}
                disabled={results.length === 0 || isProcessing || isAiFiltering}
                className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                title="پاک کردن نتایج"
            >
                <Trash2 size={20} />
            </button>
            <button 
                onClick={handleCopy}
                disabled={results.length === 0 || isProcessing || isAiFiltering}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
                <Copy size={16} />
                <span>کپی</span>
            </button>
            <button 
                onClick={handleExport}
                disabled={results.length === 0 || isProcessing || isAiFiltering}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
                <Download size={16} />
                <span>خروجی اکسل</span>
            </button>
            </div>
        </div>

        {/* NEW: Filter & Selection Toolbar */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-3">
             <div className="relative flex-1 min-w-[200px]">
                <input 
                    type="text" 
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="فیلتر کلمات (مثل گوگل شیت)..."
                    className="w-full pl-10 pr-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm outline-none"
                    disabled={isProcessing}
                />
                <Filter className="absolute left-3 top-2.5 text-gray-400" size={16} />
             </div>
             <div className="flex items-center gap-2 px-2">
                 <input 
                     type="checkbox" 
                     id="exclude-filter"
                     checked={isExclude} 
                     onChange={(e) => setIsExclude(e.target.checked)} 
                     className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                     disabled={isProcessing}
                 />
                 <label htmlFor="exclude-filter" className="text-sm text-gray-700 select-none cursor-pointer">
                     مستثنی کردن کلمات
                 </label>
             </div>
             {selectedIds.size > 0 && (
                 <button 
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm shadow-sm animate-in fade-in"
                 >
                    <Trash2 size={16} />
                    <span>حذف ({selectedIds.size})</span>
                 </button>
             )}
             <button 
                onClick={handleDeleteZeroVolume}
                disabled={results.length === 0 || isProcessing}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors disabled:opacity-50"
                title="حذف تمام کلماتی که سرچ والیوم آنها صفر است"
             >
                <MinusSquare size={16} />
                <span>حذف سرچ صفر</span>
             </button>
             <button 
                onClick={handleContinueWithSelected}
                disabled={filteredResults.length === 0 || isProcessing}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors mr-auto disabled:opacity-50"
             >
                <Layers size={16} />
                <span>انتقال به لیست اولیه (جهت تعمیق)</span>
             </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 overflow-hidden flex flex-col min-h-[500px]">
        <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm text-right text-gray-500">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-0">
                <tr>
                <th scope="col" className="px-4 py-3 w-10 text-center">
                    <button 
                        onClick={handleSelectAll}
                        disabled={filteredResults.length === 0}
                        className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                        title={filteredResults.length > 0 && filteredResults.every(r => selectedIds.has(r.id)) ? "لغو انتخاب همه" : "انتخاب همه موارد نمایش داده شده"}
                    >
                        {filteredResults.length > 0 && filteredResults.every(r => selectedIds.has(r.id)) ? (
                            <CheckSquare size={18} />
                        ) : selectedIds.size > 0 && filteredResults.some(r => selectedIds.has(r.id)) ? (
                            <MinusSquare size={18} />
                        ) : (
                            <Square size={18} />
                        )}
                    </button>
                </th>
                <th scope="col" className="px-6 py-3 w-16 text-center">#</th>
                <th scope="col" className="px-6 py-3">کلمه کلیدی (Keyword)</th>
                {language !== 'fa' && <th scope="col" className="px-6 py-3">ترجمه فارسی (AI)</th>}
                <th scope="col" className="px-6 py-3">منبع (Seed)</th>
                <th scope="col" className="px-6 py-3 w-32 text-center cursor-pointer hover:bg-gray-100 transition-colors select-none" onClick={handleSortByVolume} title="مرتب‌سازی بر اساس حجم جستجو">
                    <div className="flex justify-center items-center gap-1">
                        سرچ والیوم
                        {sortConfig && sortConfig.key === 'volume' ? (
                            <span className="text-blue-600">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                        ) : (
                            <span className="text-gray-300">↕</span>
                        )}
                    </div>
                </th>
                <th scope="col" className="px-4 py-3 w-20 text-center">CPC ($)</th>
                <th scope="col" className="px-4 py-3 w-24 text-center text-xs">رقابت (Mizfa)</th>
                <th scope="col" className="px-4 py-3 w-24 text-center text-xs">سختی (Mizfa)</th>
                <th scope="col" className="px-6 py-3 w-24 text-center">لایه</th>
                <th scope="col" className="px-6 py-3 w-20 text-center">عملیات</th>
                </tr>
            </thead>
            <tbody className={`${isAiFiltering || isFetchingVolume ? 'opacity-50' : ''}`}>
                {filteredResults.length === 0 ? (
                <tr>
                    <td colSpan={10} className="px-6 py-20 text-center text-gray-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                        {filterText ? <Eraser size={48} className="opacity-20" /> : <Layers size={48} className="opacity-20" />}
                        <p>{filterText ? 'هیچ کلمه‌ای با این فیلتر پیدا نشد.' : 'هنوز داده‌ای وجود ندارد. کلمات را وارد کرده و دکمه شروع را بزنید.'}</p>
                    </div>
                    </td>
                </tr>
                ) : (
                filteredResults.map((row, index) => {
                    const isSelected = selectedIds.has(row.id);
                    return (
                        <tr key={row.id} className={`border-b transition-colors group ${isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'bg-white hover:bg-gray-50'}`}>
                        <td className="px-4 py-3 text-center">
                            <button 
                                onClick={() => handleSelectRow(row.id)}
                                className={`transition-colors ${isSelected ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                            </button>
                        </td>
                        <td className="px-6 py-3 text-center text-gray-400">{index + 1}</td>
                        <td className="px-6 py-3 font-medium text-gray-900">
                            <div className="flex items-center gap-2">
                                <span>{row.keyword}</span>
                                {row.isMizfa && (
                                    <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded font-medium border border-amber-200">
                                        Mizfa Planner
                                    </span>
                                )}
                            </div>
                        </td>
                        {language !== 'fa' && (
                            <td className="px-6 py-3 text-gray-700 text-xs text-right">
                                {row.translation || '-'}
                            </td>
                        )}
                        <td className="px-6 py-3 text-gray-500 text-xs">{row.sourceSeed}</td>
                        <td className="px-6 py-3 text-center font-mono">
                            {row.searchVolume !== undefined && row.searchVolume !== null ? (
                                <span className={`px-2 py-1 rounded text-xs ${Number(row.searchVolume) === 0 ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-amber-100 text-amber-800'}`}>
                                    {Number(row.searchVolume).toLocaleString('fa-IR')}
                                </span>
                            ) : (
                                <span className="text-gray-300">-</span>
                            )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-blue-800">
                            {row.cpc !== undefined && row.cpc !== null ? row.cpc : '-'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-purple-800">
                            {row.competition !== undefined && row.competition !== null ? row.competition : '-'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-orange-800">
                            {row.difficulty !== undefined && row.difficulty !== null ? row.difficulty : '-'}
                        </td>
                        <td className="px-6 py-3 text-center">
                            <span className={`px-2 py-1 rounded text-xs ${
                            row.layer === 1 ? 'bg-blue-100 text-blue-800' :
                            row.layer === 2 ? 'bg-purple-100 text-purple-800' :
                            'bg-orange-100 text-orange-800'
                            }`}>
                            لایه {row.layer}
                            </span>
                        </td>
                        <td className="px-6 py-3 text-center">
                            <button
                                onClick={() => handleDeleteItem(row.keyword)}
                                className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-50"
                                title="حذف کلمه و زیرمجموعه‌ها"
                            >
                                <XCircle size={18} />
                            </button>
                        </td>
                        </tr>
                    );
                })
                )}
            </tbody>
            </table>
        </div>
        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
            <span>
                نمایش {filteredResults.length} از {results.length}
                {selectedIds.size > 0 && ` | ${selectedIds.size} انتخاب شده`}
            </span>
            <span>Deep Suggest Fetcher v1.2 + Gemini AI</span>
        </div>
        </div>

      </div>
    </div>
  );
}