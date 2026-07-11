import React, { useState, useEffect } from 'react';
import { Database, TrendingUp, Settings, CheckCircle2, AlertCircle, BarChart3, Save, Calculator, Upload } from 'lucide-react';

interface AnalysisRow {
  domain: string;
  totalLinks: number;
  advertorialCount: number;
  isSitewide: boolean;
  unitPrice: number | null;
  totalCost: number | null;
}

export default function OffpageAnalyzer() {
  const [view, setView] = useState<'analyzer' | 'settings'>('analyzer');
  const [semrushText, setSemrushText] = useState('');
  const [pricingCsv, setPricingCsv] = useState('');
  const [results, setResults] = useState<AnalysisRow[] | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('seo_pricing_csv');
    if (saved) {
      setPricingCsv(saved);
    } else {
      setPricingCsv(
        "Media Name,Domain,Plan Name,Price (Toman),Old Price,DA,Spam Score\n" +
        "خبر فارسی,khabarfarsi.com,رپورتاژ آگهی,2650000,3150000,42,14\n" +
        "اقتصاد 24,eghtesaad24.ir,رپورتاژ آگهی,3050000,4950000,28,9\n" +
        "عصرایران (عصر ایران),asriran.com,رپورتاژ آگهی,15000000,15000000,55,1\n" +
        "خبرگزاری فارس,farsnews.ir,رپورتاژ آگهی,9957000,11064000,77,1\n" +
        "رویداد 24,rouydad24.ir,رپورتاژ آگهی,3050000,4950000,41,6\n"
      );
    }
  }, []);

  const handleSaveCsv = () => {
    localStorage.setItem('seo_pricing_csv', pricingCsv);
    alert('دیتابیس قیمت‌ها با موفقیت ذخیره شد!');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setPricingCsv(event.target.result);
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (e.target) {
        e.target.value = '';
    }
  };

  const parsePricingRaw = (csvData: string) => {
    const lines = csvData.split('\n');
    const domainPrices = new Map<string, number[]>();

    lines.forEach(line => {
      const delimiter = line.includes('\t') ? '\t' : ',';
      const parts = line.split(delimiter);
      
      if (parts.length >= 2) {
        let domainIndex = 1;
        let priceIndex = 3;

        // Try to identify domain index
        const potentialDomainIdx = parts.findIndex(p => p.trim().includes('.') && !p.includes(' '));
        if (potentialDomainIdx !== -1) domainIndex = potentialDomainIdx;

        const domain = parts[domainIndex]?.trim().toLowerCase();
        let price = -1;
        
        // Find price from right to left
        for (let i = parts.length - 1; i >= 0; i--) {
            const parsed = parseInt(parts[i]?.trim()?.replace(/,/g, ''), 10);
            if (!isNaN(parsed) && parsed > 1000) {
                price = parsed;
                break;
            }
        }
        
        if (domain && price !== -1) {
          if (!domainPrices.has(domain)) {
            domainPrices.set(domain, []);
          }
          domainPrices.get(domain)!.push(price);
        }
      }
    });

    const averagePrices = new Map<string, number>();
    domainPrices.forEach((prices, domain) => {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      averagePrices.set(domain, avg);
    });

    return averagePrices;
  };

  const parseSemrushData = (text: string) => {
    const lines = text.split('\n').map(l => l.trim().toLowerCase()).filter(l => l !== '');
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
    const ipRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
    
    const resultsMap = new Map<string, number>();
    let currentDomain = '';

    for (let i = 0; i < lines.length; i++) {
        const lineStr = lines[i].replace(/,/g, '');
        const isIp = ipRegex.test(lineStr) || (lineStr.includes(':') && lineStr.split(':').length > 2 && /^[a-f0-9:]+$/.test(lineStr));
        const isDomain = domainRegex.test(lineStr) && !lineStr.includes(' ');

        if (isDomain) {
            currentDomain = lineStr;
        } else if (isIp && currentDomain && i > 0) {
            const prevLine = lines[i - 1].replace(/,/g, '');
            let links = 0;
            
            if (prevLine.endsWith('k')) {
                links = Math.round(parseFloat(prevLine) * 1000);
            } else if (prevLine.endsWith('m')) {
                links = Math.round(parseFloat(prevLine) * 1000000);
            } else if (/^\d+$/.test(prevLine)) {
                links = parseInt(prevLine, 10);
            }

            if (links > 0) {
                resultsMap.set(currentDomain, (resultsMap.get(currentDomain) || 0) + links);
            }
            currentDomain = ''; // Reset after consuming
        }
    }
    return Array.from(resultsMap.entries()).map(([domain, totalLinks]) => ({ domain, totalLinks }));
  };

  const analyze = () => {
    if (!semrushText.trim()) return;

    const extracted = parseSemrushData(semrushText);
    const pricingMap = parsePricingRaw(pricingCsv);

    const mapped: AnalysisRow[] = extracted.map(item => {
      // Threshold for sitewide links => separating the cost 
      const isSitewide = item.totalLinks >= 500;
      // Default calculating 1 advertorial per 2 links, or just 1 if sitewide
      const advertorialCount = isSitewide ? 1 : Math.ceil(item.totalLinks / 2);
      
      let unitPrice = pricingMap.get(item.domain) || null;
      if (unitPrice === null) {
         const stripped = item.domain.replace(/^www\./, '');
         unitPrice = pricingMap.get(stripped) || null;
      }

      const totalCost = unitPrice !== null ? unitPrice * advertorialCount : null;

      return {
        domain: item.domain,
        totalLinks: item.totalLinks,
        advertorialCount,
        isSitewide,
        unitPrice,
        totalCost
      };
    });

    mapped.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0));
    setResults(mapped);
  };

  const updateRowLinks = (index: number, newLinks: number) => {
    setResults(prev => {
      if (!prev) return prev;
      const newResults = [...prev];
      const row = { ...newResults[index] };
      row.totalLinks = newLinks;
      row.isSitewide = newLinks >= 500;
      row.advertorialCount = row.isSitewide ? 1 : Math.ceil(newLinks / 2);
      row.totalCost = row.unitPrice !== null ? row.unitPrice * row.advertorialCount : null;
      newResults[index] = row;
      return newResults;
    });
  };

  const updateRowAdvertorials = (index: number, newAdvs: number) => {
    setResults(prev => {
      if (!prev) return prev;
      const newResults = [...prev];
      const row = { ...newResults[index] };
      row.advertorialCount = newAdvs;
      row.totalCost = row.unitPrice !== null ? row.unitPrice * row.advertorialCount : null;
      newResults[index] = row;
      return newResults;
    });
  };

  return (
    <div className="bg-white rounded-xl flex flex-col gap-6">
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setView('analyzer')}
          className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${
            view === 'analyzer' ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <BarChart3 size={18} />
          بررسی بک‌لینک (Semrush)
        </button>
        <button
          onClick={() => setView('settings')}
          className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${
            view === 'settings' ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Database size={18} />
          تنظیمات دیتابیس قیمت
        </button>
      </div>

      <div className="p-2">
        {view === 'settings' && (
          <div className="space-y-4">
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-start gap-3 border border-blue-100">
              <AlertCircle className="mt-0.5" size={20} />
              <div>
                <h4 className="font-semibold text-sm">محفوظ ماندن دیتابیس قیمت‌ها</h4>
                <p className="text-sm mt-1 opacity-90 leading-relaxed">
                  لیست متنی قیمت های خود (به همراه دامنه و ستون ها) را در کادر زیر قرار داده و ذخیره کنید. اطلاعات در مرورگر شما قفل شده و در مراجعات بعدی نیاز به وارد کردن مجدد اطلاعات ندارید. این کار باعث می‌شود فایل اپلیکیشن سبک و سریع باقی بماند.
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  دیتای قیمت رسانه‌ها (طرح اکسل/CSV)
                </label>
                <label className="cursor-pointer text-xs flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors">
                  <Upload size={14} />
                  ایمپورت فایل CSV
                  <input
                    type="file"
                    accept=".csv, .txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <textarea
                value={pricingCsv}
                onChange={(e) => setPricingCsv(e.target.value)}
                placeholder="Media Name,Domain,Plan Name,Price (Toman)..."
                className="w-full h-80 p-4 font-mono text-sm text-left bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                dir="ltr"
              />
            </div>
            
            <button
              onClick={handleSaveCsv}
              className="flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition-colors"
            >
              <Save size={18} />
              ذخیره در هسته مرورگر
            </button>
          </div>
        )}

        {view === 'analyzer' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">محتوای کپی شده از گزارش Semrush</label>
                <textarea
                  value={semrushText}
                  onChange={(e) => setSemrushText(e.target.value)}
                  placeholder="2\navalkhabar.ir\nDesign\n\n42\nmashreghnews.ir..."
                  className="w-full h-64 p-4 font-mono text-sm text-left bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500"
                  dir="ltr"
                />
                <button
                  onClick={analyze}
                  disabled={!semrushText.trim()}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  <Calculator size={18} />
                  تحلیل خودکار هزینه‌ها
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h3 className="text-gray-700 font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={18} className="text-teal-600" />
                  خلاصه وضعیت آف‌پیج
                </h3>
                
                {results ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 text-center flex flex-col justify-center">
                        <p className="text-gray-500 text-xs mb-1">تعداد کل دامنه ها</p>
                        <p className="text-2xl font-bold text-gray-800">{results.length}</p>
                      </div>
                      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 text-center flex flex-col justify-center">
                        <p className="text-gray-500 text-xs mb-1">دامنه‌های پیدا شده در دیتابیس</p>
                        <p className="text-2xl font-bold text-teal-600">
                          {results.filter(r => r.unitPrice !== null).length}
                        </p>
                      </div>
                    </div>
                    
                    <div className="bg-white p-5 rounded-lg shadow-sm border border-teal-200 text-center">
                      <p className="text-gray-600 text-sm mb-2">تخمین کل هزینه‌ها (تومان)</p>
                      <p className="text-3xl font-black text-teal-700">
                        {results.reduce((acc, r) => acc + (r.totalCost || 0), 0).toLocaleString('fa-IR')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="h-[250px] flex flex-col items-center justify-center text-gray-400">
                    <Database size={48} className="opacity-20 mb-4" />
                    <p className="text-sm">داده‌ها را کپی کنید و روی دکمه محاسبه کلیک کنید</p>
                  </div>
                )}
              </div>
            </div>

            {results && (
              <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden relative shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right text-gray-600">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-4 font-semibold text-right">دامنه</th>
                        <th className="px-4 py-4 font-semibold text-center">تعداد لینک خروجی</th>
                        <th className="px-4 py-4 font-semibold text-center">تعداد رپورتاژ (تخمین)</th>
                        <th className="px-4 py-4 font-semibold text-center">تحلیل وضعیت لینک</th>
                        <th className="px-4 py-4 font-semibold text-center">متوسط قیمت رسانه (تومان)</th>
                        <th className="px-4 py-4 font-semibold text-center">ارزش تخمینی (تومان)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {results.map((row, idx) => (
                        <tr key={idx} className={row.unitPrice === null ? 'bg-red-50/30' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-3 font-mono text-left opacity-90" dir="ltr">{row.domain}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min="0"
                              value={row.totalLinks === 0 ? '' : row.totalLinks}
                              onChange={(e) => updateRowLinks(idx, parseInt(e.target.value) || 0)}
                              className="w-20 px-2 py-1 text-center border border-gray-300 rounded focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min="0"
                              value={row.advertorialCount === 0 ? '' : row.advertorialCount}
                              onChange={(e) => updateRowAdvertorials(idx, parseInt(e.target.value) || 0)}
                              className="w-20 px-2 py-1 text-center border border-gray-300 rounded focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.isSitewide ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-800">
                                سایت‌واید
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                                عادی
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.unitPrice ? row.unitPrice.toLocaleString('fa-IR') : '-'}
                          </td>
                          <td className={`px-4 py-3 text-center font-medium ${row.unitPrice === null ? 'text-red-500' : 'text-gray-900'}`}>
                            {row.totalCost !== null ? row.totalCost.toLocaleString('fa-IR') : 'نامشخص در دیتابیس'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
