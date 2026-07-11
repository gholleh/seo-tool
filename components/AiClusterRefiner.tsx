import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  BrainCircuit, 
  Download, 
  Terminal,
  Loader2,
  FileSpreadsheet,
  Network,
  GitBranch,
  Lightbulb,
  Merge,
  Split,
  Edit2,
  Save,
  RefreshCw,
  MessageSquarePlus
} from 'lucide-react';
import { refineClusteringStrategy } from '../services/geminiService';

interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: string;
}

interface RefinedClusterData {
    id: string; // Unique ID for React Key (e.g. "merged_1")
    displayIds: string; // The user-facing ID string (e.g. "24, 25, 36-1")
    clusterName: string;
    intent: string;
    parents: string; // Pipe separated string for UI editing
    totalVolume: number;
    keywords: string[]; // List of keywords in this group
}

export default function AiClusterRefiner() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [workbookData, setWorkbookData] = useState<string | ArrayBuffer | null>(null);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [volumeColumn, setVolumeColumn] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [refinedClusters, setRefinedClusters] = useState<RefinedClusterData[]>([]);
  const [originalRows, setOriginalRows] = useState<any[]>([]);
  
  // Custom prompt state
  const [customInstruction, setCustomInstruction] = useState<string>('');
  
  // Metadata for volume calculation
  const [keywordMeta, setKeywordMeta] = useState<Record<string, number>>({}); 

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 100));
  };

  useEffect(() => {
    if (workbookData && selectedSheet) {
      try {
        const wb = XLSX.read(workbookData, { type: 'binary' });
        const sheet = wb.Sheets[selectedSheet];
        if (sheet) {
          const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[] || [];
          setAvailableColumns(headers);
          
          if (headers.length > 0) {
            const defaultVol = headers.find(h => {
              const hLow = String(h).trim().toLowerCase();
              return ['volume', 'search volume', 'avg monthly searches', 'vol', 'impression', 'search_volume'].includes(hLow);
            });
            setVolumeColumn(defaultVol || headers[0]);
          }
        }
      } catch (e) {
        console.error("Error reading headers", e);
      }
    }
  }, [workbookData, selectedSheet]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      addLog(`فایل انتخاب شد: ${selectedFile.name}`, 'info');

      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        setWorkbookData(bstr || null);
        if (bstr) {
            try {
                const wb = XLSX.read(bstr, { type: 'binary' });
                setSheetNames(wb.SheetNames);
                if (wb.SheetNames.length > 0) {
                  setSelectedSheet(wb.SheetNames[0]);
                }
            } catch (err) {
                console.error(err);
                addLog('خطا در خواندن فایل اکسل.', 'error');
            }
        }
      };
      reader.readAsBinaryString(selectedFile);
    }
  };

  const processFileAndRunAi = async () => {
    if (!file || !workbookData) return addLog('لطفا فایل اکسل کلاستر شده را آپلود کنید.', 'error');
    if (!selectedSheet) return addLog('لطفا یک شیت را انتخاب کنید.', 'error');
    if (!process.env.API_KEY) return addLog('API Key یافت نشد. (لطفا process.env.API_KEY را بررسی کنید)', 'error');

    setIsProcessing(true);
    setLogs([]);
    setRefinedClusters([]);
    setKeywordMeta({});

    try {
        const workbook = XLSX.read(workbookData, { type: 'binary' });
        const sheet = workbook.Sheets[selectedSheet];
        if (!sheet) {
           throw new Error("شیت انتخاب شده معتبر نیست.");
        }
        let jsonData: any[] = XLSX.utils.sheet_to_json(sheet);

        const rawRows = [...jsonData];

        // Normalize headers & Extract Volume
        const meta: Record<string, number> = {};
        jsonData = jsonData.map((row, index) => {
            const newRow: any = {};
            let volume = 0;
            
            if (volumeColumn && row[volumeColumn] !== undefined) {
                volume = parseInt(row[volumeColumn]) || 0;
            }

            Object.keys(row).forEach(key => {
                const normKey = key.trim().toLowerCase().replace(/ /g, '_');
                newRow[normKey] = row[key];
                
                if (!volumeColumn && ['volume', 'search_volume', 'avg_monthly_searches', 'vol'].includes(normKey)) {
                    volume = parseInt(row[key]) || 0;
                }
                if (normKey === 'cluster_id' || normKey === 'id') newRow['cluster_id'] = row[key];
                if (normKey === 'query' || normKey === 'keyword' || normKey === 'top_queries') newRow['query'] = row[key];
            });
            if (newRow.query) {
                meta[String(newRow.query).trim()] = volume;
                rawRows[index]._normalizedQuery = String(newRow.query).trim();
            }
            return newRow;
        });
        setKeywordMeta(meta);
        setOriginalRows(rawRows);

        const validRows = jsonData.filter(r => r.cluster_id && r.query);
        if (validRows.length === 0) return addLog('فایل نامعتبر است. ستون‌های Cluster ID و Query پیدا نشدند.', 'error');

        addLog(`${validRows.length} کلمه خوانده شد. شروع تحلیل هوشمند...`, 'info');

        const clusterMap = new Map<number, string[]>();
        validRows.forEach(row => {
            const id = parseInt(row.cluster_id);
            if (!clusterMap.has(id)) clusterMap.set(id, []);
            clusterMap.get(id)?.push(String(row.query).trim());
        });

        const clustersInput = Array.from(clusterMap.entries()).map(([id, keywords]) => ({
            id,
            keywords
        }));

        // 1. Get AI Results
        addLog(`ارسال ${clustersInput.length} کلاستر به هوش مصنوعی...`, 'info');
        const aiResults = await refineClusteringStrategy(clustersInput, customInstruction);

        // 2. PROCESS SPLITS (n+1 Logic)
        const idCounts = new Map<number, number>();
        aiResults.forEach(res => {
            idCounts.set(res.originalId, (idCounts.get(res.originalId) || 0) + 1);
        });

        const idIterators = new Map<number, number>();
        const processedWithSplitIds = aiResults.map(res => {
            const count = idCounts.get(res.originalId) || 0;
            let finalId = res.originalId.toString();

            if (count > 1) {
                const currentIter = (idIterators.get(res.originalId) || 0);
                idIterators.set(res.originalId, currentIter + 1);
                
                if (currentIter > 0) {
                    finalId = `${res.originalId}-${currentIter}`;
                }
            }
            return { ...res, finalDisplayId: finalId };
        });

        // 3. PROCESS MERGES (Group by Name + Intent)
        addLog('در حال ادغام (Merging) و آماده‌سازی جدول...', 'info');
        const mergedGroups = new Map<string, {
            name: string;
            intent: string;
            parents: Set<string>;
            ids: Set<string>;
            keywords: Set<string>;
        }>();

        processedWithSplitIds.forEach(item => {
            const normName = item.newClusterName.trim();
            const key = `${normName}::${item.intent}`;

            if (!mergedGroups.has(key)) {
                mergedGroups.set(key, {
                    name: normName,
                    intent: item.intent,
                    parents: new Set(),
                    ids: new Set(),
                    keywords: new Set()
                });
            }

            const group = mergedGroups.get(key)!;
            group.ids.add(item.finalDisplayId);
            item.keywords.forEach(k => group.keywords.add(k));
            if (item.parents) item.parents.forEach(p => group.parents.add(p));
        });

        // 4. Convert to State Array
        const finalState: RefinedClusterData[] = [];
        let indexCounter = 0;

        mergedGroups.forEach(group => {
            let vol = 0;
            group.keywords.forEach(k => {
                vol += (meta[k] || 0);
            });

            const sortedIds = Array.from(group.ids).sort((a, b) => {
                const numA = parseInt(a.split('-')[0]);
                const numB = parseInt(b.split('-')[0]);
                return numA - numB;
            });

            const parentStr = group.parents.size > 0 
                ? Array.from(group.parents).filter(p => p !== 'Root').join(' | ') 
                : '';

            finalState.push({
                id: `cluster_${indexCounter++}`,
                displayIds: sortedIds.join(', '),
                clusterName: group.name,
                intent: group.intent,
                parents: parentStr,
                totalVolume: vol,
                keywords: Array.from(group.keywords)
            });
        });

        finalState.sort((a, b) => b.totalVolume - a.totalVolume);

        setRefinedClusters(finalState);
        addLog(`ساختار نهایی ایجاد شد. شما می‌توانید جدول را ویرایش کنید.`, 'success');

      } catch (err: any) {
        console.error(err);
        addLog('خطا: ' + err.message, 'error');
      } finally {
        setIsProcessing(false);
      }
  };

  // --- Handlers for Editing ---
  const handleEdit = (id: string, field: keyof RefinedClusterData, value: string) => {
    setRefinedClusters(prev => prev.map(item => {
        if (item.id === id) {
            return { ...item, [field]: value };
        }
        return item;
    }));
  };

  // --- Mind Map Generation ---
  const generateHierarchicalMindMap = () => {
    if (refinedClusters.length === 0) return '';

    const nodes = new Map<string, { 
        intent: string; 
        id: string; 
        volume: number;
        parents: string[];
    }>();

    refinedClusters.forEach(row => {
        const cName = row.clusterName.trim();
        if (!cName) return;

        if (nodes.has(cName)) {
             const existing = nodes.get(cName)!;
             existing.volume += row.totalVolume;
             const pList = row.parents ? row.parents.split('|').map(p => p.trim()) : [];
             pList.forEach(p => {
                 if (!existing.parents.includes(p)) existing.parents.push(p);
             });
        } else {
            nodes.set(cName, {
                intent: row.intent,
                id: `n${Math.abs(hashCode(cName))}`,
                volume: row.totalVolume,
                parents: row.parents ? row.parents.split('|').map(p => p.trim()).filter(Boolean) : []
            });
        }
    });

    let mermaid = 'graph LR\n';
    mermaid += '  Root((صفحه اصلی)):::root\n';
    const edges = new Set<string>();

    nodes.forEach((data, name) => {
        let open = '['; let close = ']';
        let styleClass = 'catIntent';

        if (data.intent === 'Product') { open = '(['; close = '])'; styleClass = 'productIntent'; }
        else if (data.intent === 'Blog') { open = '{{'; close = '}}'; styleClass = 'blogIntent'; }
        else if (data.intent === 'SubCategory') { open = '[['; close = ']]'; styleClass = 'subCatIntent'; }
        else if (data.intent === 'Tag') { open = '>'; close = ']'; styleClass = 'tagIntent'; }

        const label = `"${name}\\n(Vol: ${data.volume.toLocaleString()})"`;
        mermaid += `  ${data.id}${open}${label}${close}:::${styleClass}\n`;

        if (data.parents.length === 0) {
             const edge = `Root --> ${data.id}`;
             if (!edges.has(edge)) { mermaid += `  ${edge}\n`; edges.add(edge); }
        } else {
            data.parents.forEach(pName => {
                let parentId;
                if (nodes.has(pName)) {
                    parentId = nodes.get(pName)!.id;
                } else {
                    parentId = `v_${Math.abs(hashCode(pName))}`;
                    const vEdgeKey = `virtual:${parentId}`;
                    if (!edges.has(vEdgeKey)) {
                        mermaid += `  ${parentId}["${pName}"]:::virtualNode\n`;
                        mermaid += `  Root -.-> ${parentId}\n`;
                        edges.add(vEdgeKey);
                    }
                }
                const edgeKey = `${parentId}->${data.id}`;
                if (!edges.has(edgeKey)) {
                    mermaid += `  ${parentId} --> ${data.id}\n`;
                    edges.add(edgeKey);
                }
            });
        }
    });

    mermaid += '\n  classDef root fill:#1e293b,stroke:#fff,color:#fff,stroke-width:2px;';
    mermaid += '\n  classDef catIntent fill:#3b82f6,stroke:#1d4ed8,color:#fff,rx:5px;';
    mermaid += '\n  classDef subCatIntent fill:#60a5fa,stroke:#2563eb,color:#fff,rx:5px;';
    mermaid += '\n  classDef productIntent fill:#ef4444,stroke:#b91c1c,color:#fff;';
    mermaid += '\n  classDef blogIntent fill:#10b981,stroke:#047857,color:#fff;';
    mermaid += '\n  classDef tagIntent fill:#f59e0b,stroke:#d97706,color:#fff,stroke-dasharray: 5 5;';
    mermaid += '\n  classDef virtualNode fill:#94a3b8,stroke:#64748b,color:#fff,stroke-dasharray: 3 3;';

    return mermaid;
  };

  const hashCode = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash = hash & hash; 
    }
    return hash;
  };

  const handleDownloadMindMap = () => {
      const content = generateHierarchicalMindMap();
      if (!content) return addLog('داده‌ای برای ساخت گراف وجود ندارد.', 'error');
      
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `seo_architecture_mermaid.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog('فایل Mermaid دانلود شد. می‌توانید در mermaid.live مشاهده کنید.', 'success');
  };

  const handleDownloadExcel = () => {
    if (refinedClusters.length === 0) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(refinedClusters.map(r => ({
        'Source IDs': r.displayIds,
        'Page Title (Cluster)': r.clusterName,
        'Intent': r.intent,
        'Parent Category': r.parents || 'Root',
        'Total Search Volume': r.totalVolume,
        'Keywords List': r.keywords.join(', ')
    })));
    XLSX.utils.book_append_sheet(wb, ws, "WordPress Structure");

    // New Sheet: Keyword Mapping
    const keywordToCluster = new Map<string, RefinedClusterData>();
    refinedClusters.forEach(r => {
        r.keywords.forEach(kw => {
            keywordToCluster.set(kw, r);
        });
    });

    const mappingData = originalRows.map(row => {
        const newRow = { ...row };
        const cluster = row._normalizedQuery ? keywordToCluster.get(row._normalizedQuery) : null;
        delete newRow._normalizedQuery;

        // Add mapping data
        newRow['Mapped Cluster Name'] = cluster ? cluster.clusterName : '';
        newRow['Mapped Cluster ID'] = cluster ? cluster.displayIds : '';
        newRow['URL Slug'] = cluster ? cluster.clusterName.trim().replace(/\s+/g, '-').toLowerCase() : '';
        newRow['Mapped Intent'] = cluster ? cluster.intent : '';
        newRow['Mapped Parent Category'] = cluster ? cluster.parents : '';

        return newRow;
    });

    mappingData.sort((a, b) => String(a['Mapped Cluster ID'] || '').localeCompare(String(b['Mapped Cluster ID'] || ''), undefined, { numeric: true }));

    const wsMapping = XLSX.utils.json_to_sheet(mappingData);
    XLSX.utils.book_append_sheet(wb, wsMapping, "Keyword Mapping");

    let filename = "wordpress_seo_structure.xlsx";
    if (refinedClusters.length > 0 && refinedClusters[0].keywords && refinedClusters[0].keywords.length > 0) {
        const firstKeyword = refinedClusters[0].keywords[0].replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').trim().replace(/\s+/g, '_');
        if (firstKeyword) {
            filename = `seo_structure_${firstKeyword}.xlsx`;
        }
    }

    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-100px)]">
       {/* Sidebar Config */}
       <div className="lg:col-span-3 space-y-4 flex flex-col h-full overflow-hidden">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
             <h2 className="text-md font-bold mb-3 flex items-center gap-2 text-gray-800">
               <BrainCircuit size={18} className="text-purple-600" />
               تنظیمات ورودی
             </h2>

             <div className="space-y-4">
               {/* File Input */}
               <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-purple-500 transition-colors bg-gray-50">
                    <input 
                        type="file" 
                        accept=".xlsx" 
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={isProcessing}
                    />
                    <div className="flex flex-col items-center gap-1 text-gray-500">
                        {isProcessing ? <Loader2 className="animate-spin text-purple-600" /> : <Upload size={24} />}
                        <span className="text-xs">{file ? file.name : "آپلود فایل کلاستر"}</span>
                    </div>
               </div>

               {/* Sheet Selection */}
               {sheetNames.length > 1 && (
                 <div>
                   <label className="block text-xs font-medium text-gray-700 mb-1">انتخاب شیت</label>
                   <select 
                     value={selectedSheet} 
                     onChange={(e) => setSelectedSheet(e.target.value)}
                     className="w-full p-2 border border-gray-300 rounded-md text-sm"
                     disabled={isProcessing}
                   >
                     {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                   </select>
                 </div>
               )}

               {/* Volume Column Selection */}
               {availableColumns.length > 0 && (
                 <div>
                   <label className="block text-xs font-medium text-gray-700 mb-1">ستون میزان جستجو (Search Volume)</label>
                   <select 
                     value={volumeColumn} 
                     onChange={(e) => setVolumeColumn(e.target.value)}
                     className="w-full p-2 border border-gray-300 rounded-md text-sm"
                     disabled={isProcessing}
                   >
                     <option value="">انتخاب خودکار</option>
                     {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                   </select>
                 </div>
               )}

               {/* Custom Prompt Input */}
               <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                     <MessageSquarePlus size={12} className="text-blue-500" />
                     دستورالعمل هوش مصنوعی (اختیاری)
                  </label>
                  <textarea 
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="مثال: روی فروشگاه لباس تمرکز کن. دسته‌بندی‌ها ساده باشند. برندها را جدا نکن..."
                    className="w-full h-24 p-2 border border-gray-300 rounded-lg text-xs resize-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
                    disabled={isProcessing}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">این متن به عنوان راهنمای اضافی به پرامپت اضافه می‌شود.</p>
               </div>

               <button 
                 onClick={processFileAndRunAi}
                 disabled={isProcessing}
                 className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-all text-sm font-medium shadow-sm"
               >
                 {isProcessing ? 'در حال تحلیل...' : 'اجرای هوش مصنوعی'}
               </button>
             </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex-1 flex flex-col min-h-0">
             <h2 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-2 border-b border-gray-100 pb-2">
              <Terminal size={14} />
              رخدادها
            </h2>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar pr-1">
              {logs.map((log) => (
                <div key={log.id} className={`flex gap-1 ${
                  log.type === 'error' ? 'text-red-500' : 
                  log.type === 'success' ? 'text-green-600' : 'text-gray-500'
                }`}>
                  <span className="opacity-50">[{log.timestamp.split(' ')[0]}]</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
       </div>

       {/* Main Content: Editable Table */}
       <div className="lg:col-span-9 flex flex-col h-full space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
                
                {/* Header */}
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-3">
                        <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
                            <GitBranch size={20} className="text-purple-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 text-sm">معماری محتوای وردپرس</h3>
                            <p className="text-xs text-gray-500">
                                {refinedClusters.length > 0 ? `${refinedClusters.length} صفحه شناسایی شد.` : 'منتظر پردازش...'}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <button 
                            onClick={handleDownloadMindMap}
                            disabled={refinedClusters.length === 0}
                            className="flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 text-xs shadow-sm disabled:opacity-50"
                        >
                            <Network size={16} />
                            <span>گراف (Mermaid)</span>
                        </button>
                        <button 
                            onClick={handleDownloadExcel}
                            disabled={refinedClusters.length === 0}
                            className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 text-xs shadow-sm disabled:opacity-50"
                        >
                            <Download size={16} />
                            <span>اکسل نهایی</span>
                        </button>
                    </div>
                </div>

                {/* Table Area */}
                <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50 relative">
                    {refinedClusters.length > 0 ? (
                        <table className="w-full text-sm border-collapse">
                            <thead className="bg-white text-gray-600 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-3 py-3 text-right font-medium text-xs w-24">IDها</th>
                                    <th className="px-3 py-3 text-right font-medium text-xs w-1/4">نام صفحه (URL Slug)</th>
                                    <th className="px-3 py-3 text-right font-medium text-xs w-24">Volume</th>
                                    <th className="px-3 py-3 text-right font-medium text-xs w-32">نوع صفحه (Intent)</th>
                                    <th className="px-3 py-3 text-right font-medium text-xs w-1/4">والد (Parent)</th>
                                    <th className="px-3 py-3 text-right font-medium text-xs">کلمات کلیدی</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {refinedClusters.map((row) => (
                                    <tr key={row.id} className="hover:bg-blue-50 transition-colors group">
                                        {/* IDs */}
                                        <td className="px-3 py-2 align-top">
                                            <div className="flex flex-wrap gap-1">
                                                {row.displayIds.split(', ').map(id => (
                                                    <span key={id} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                                        id.includes('-') ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-100 border-gray-200 text-gray-600'
                                                    }`}>
                                                        {id}
                                                        {id.includes('-') && <Split size={8} className="inline mr-1" />}
                                                    </span>
                                                ))}
                                                {row.displayIds.includes(',') && <Merge size={12} className="text-purple-400 mt-0.5" />}
                                            </div>
                                        </td>

                                        {/* Editable Name */}
                                        <td className="px-3 py-2 align-top">
                                            <div className="relative">
                                                <input 
                                                    type="text" 
                                                    value={row.clusterName}
                                                    onChange={(e) => handleEdit(row.id, 'clusterName', e.target.value)}
                                                    className="w-full p-1.5 border border-transparent hover:border-gray-300 focus:border-blue-500 rounded text-gray-800 font-bold bg-transparent focus:bg-white transition-all outline-none"
                                                />
                                                <Edit2 size={12} className="absolute left-2 top-2.5 text-gray-300 opacity-0 group-hover:opacity-100 pointer-events-none" />
                                            </div>
                                        </td>

                                        {/* Volume */}
                                        <td className="px-3 py-2 align-top pt-3 font-mono text-xs text-blue-600">
                                            {row.totalVolume.toLocaleString()}
                                        </td>

                                        {/* Editable Intent */}
                                        <td className="px-3 py-2 align-top">
                                            <select 
                                                value={row.intent}
                                                onChange={(e) => handleEdit(row.id, 'intent', e.target.value)}
                                                className={`w-full p-1.5 rounded text-xs border border-transparent hover:border-gray-300 focus:border-blue-500 cursor-pointer outline-none appearance-none font-medium ${
                                                    row.intent === 'Product' ? 'text-red-600 bg-red-50' :
                                                    row.intent === 'Blog' ? 'text-green-600 bg-green-50' :
                                                    row.intent === 'SubCategory' ? 'text-blue-600 bg-blue-50' :
                                                    'text-purple-600 bg-purple-50'
                                                }`}
                                            >
                                                <option value="Category">Category</option>
                                                <option value="SubCategory">SubCategory</option>
                                                <option value="Product">Product</option>
                                                <option value="Blog">Blog</option>
                                                <option value="Tag">Tag</option>
                                            </select>
                                        </td>

                                        {/* Editable Parent */}
                                        <td className="px-3 py-2 align-top">
                                            <input 
                                                type="text" 
                                                value={row.parents}
                                                onChange={(e) => handleEdit(row.id, 'parents', e.target.value)}
                                                placeholder="Root"
                                                className="w-full p-1.5 border border-transparent hover:border-gray-300 focus:border-blue-500 rounded text-gray-600 text-xs bg-transparent focus:bg-white transition-all outline-none"
                                            />
                                        </td>

                                        {/* Keywords Preview */}
                                        <td className="px-3 py-2 align-top">
                                            <div className="text-[10px] text-gray-400 leading-relaxed max-h-16 overflow-hidden">
                                                {row.keywords.join('، ')}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <div className="bg-white p-6 rounded-full shadow-sm">
                                <FileSpreadsheet size={48} className="opacity-20 text-purple-600" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-gray-600">داده‌ای موجود نیست</h3>
                                <p className="text-sm mt-1 max-w-xs mx-auto">
                                    فایل را از ستون سمت راست بارگذاری کنید تا جدول ویرایشگر فعال شود.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
       </div>

       <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}