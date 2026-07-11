import React, { useState } from 'react';
import { 
  FileText, 
  Sparkles, 
  Copy, 
  Save, 
  RefreshCw, 
  Loader2, 
  AlignRight, 
  Link as LinkIcon, 
  ShoppingBag,
  Type
} from 'lucide-react';
import { generatePageContent } from '../services/geminiService';

interface GeneratedContent {
  pageTitle: string;
  urlSlug: string;
  metaDescription: string;
  mainContent: string; // HTML
  categoryDescription: string;
  suggestedProducts: string[];
}

export default function ContentGenerator() {
  const [keywords, setKeywords] = useState<string>('');
  const [siteType, setSiteType] = useState<'Shop' | 'Blog'>('Shop');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  
  // Content State
  const [content, setContent] = useState<GeneratedContent>({
    pageTitle: '',
    urlSlug: '',
    metaDescription: '',
    mainContent: '',
    categoryDescription: '',
    suggestedProducts: []
  });

  const handleGenerate = async () => {
    const kwList = keywords.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    if (kwList.length === 0) return alert("لطفا حداقل یک کلمه کلیدی وارد کنید.");
    if (!process.env.API_KEY) return alert("API Key تنظیم نشده است.");

    setIsGenerating(true);
    try {
      const result = await generatePageContent(kwList, siteType);
      setContent(result);
    } catch (error) {
      console.error(error);
      alert("خطا در تولید محتوا. لطفا لاگ را بررسی کنید.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChange = (field: keyof GeneratedContent, value: any) => {
    setContent(prev => ({ ...prev, [field]: value }));
  };

  const handleProductChange = (index: number, val: string) => {
    const newProds = [...content.suggestedProducts];
    newProds[index] = val;
    handleChange('suggestedProducts', newProds);
  };

  const addProductSlot = () => {
    handleChange('suggestedProducts', [...content.suggestedProducts, '']);
  };

  const removeProductSlot = (index: number) => {
    const newProds = content.suggestedProducts.filter((_, i) => i !== index);
    handleChange('suggestedProducts', newProds);
  };

  const getTitleColor = (len: number) => {
    if (len === 0) return 'text-gray-400';
    if (len > 60) return 'text-red-500';
    if (len > 50) return 'text-green-600';
    return 'text-orange-500';
  };

  const getDescColor = (len: number) => {
    if (len === 0) return 'text-gray-400';
    if (len > 160) return 'text-red-500';
    if (len > 120) return 'text-green-600';
    return 'text-orange-500';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-120px)]">
      
      {/* Sidebar: Inputs */}
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
           <h2 className="text-md font-bold mb-4 flex items-center gap-2 text-gray-800">
             <Sparkles size={18} className="text-amber-500" />
             ورودی محتوا
           </h2>

           <div className="space-y-4">
             <div>
               <label className="block text-xs font-medium text-gray-700 mb-1">کلمات کلیدی هدف</label>
               <textarea 
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="w-full h-40 p-3 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="خرید کفش نایک&#10;قیمت کتونی نایک&#10;کفش ورزشی ارزان"
               />
               <p className="text-[10px] text-gray-400 mt-1">هر کلمه در یک خط</p>
             </div>

             <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">نوع صفحه</label>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button 
                        onClick={() => setSiteType('Shop')}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-all ${siteType === 'Shop' ? 'bg-white shadow text-amber-600 font-bold' : 'text-gray-500'}`}
                    >
                        فروشگاهی (Product/Cat)
                    </button>
                    <button 
                        onClick={() => setSiteType('Blog')}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-all ${siteType === 'Blog' ? 'bg-white shadow text-blue-600 font-bold' : 'text-gray-500'}`}
                    >
                        مقاله (Blog Post)
                    </button>
                </div>
             </div>

             <button 
               onClick={handleGenerate}
               disabled={isGenerating}
               className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white py-2.5 rounded-lg hover:from-amber-600 hover:to-orange-700 transition-all shadow-md disabled:opacity-70"
             >
               {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
               <span>تولید محتوا با AI</span>
             </button>
           </div>
        </div>
      </div>

      {/* Main: Editor */}
      <div className="lg:col-span-9 space-y-6 pb-10">
          
          {/* SEO Meta Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
                  <FileText size={16} />
                  اطلاعات سئو (Meta Data)
              </h3>
              
              <div className="space-y-4">
                  {/* Title */}
                  <div>
                      <div className="flex justify-between mb-1">
                          <label className="text-xs font-medium text-gray-600">Page Title (تایتل)</label>
                          <span className={`text-xs font-mono ${getTitleColor(content.pageTitle.length)}`}>
                              {content.pageTitle.length} / 60
                          </span>
                      </div>
                      <input 
                        type="text" 
                        value={content.pageTitle}
                        onChange={(e) => handleChange('pageTitle', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none"
                        dir="rtl"
                      />
                  </div>

                  {/* Slug */}
                  <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">URL Slug (نامک)</label>
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2">
                          <LinkIcon size={14} className="text-gray-400" />
                          <span className="text-gray-400 text-xs">example.com/</span>
                          <input 
                            type="text" 
                            value={content.urlSlug}
                            onChange={(e) => handleChange('urlSlug', e.target.value)}
                            className="flex-1 bg-transparent text-sm outline-none text-gray-700 font-mono"
                            dir="ltr"
                          />
                      </div>
                  </div>

                  {/* Description */}
                  <div>
                      <div className="flex justify-between mb-1">
                          <label className="text-xs font-medium text-gray-600">Meta Description (توضیحات متا)</label>
                          <span className={`text-xs font-mono ${getDescColor(content.metaDescription.length)}`}>
                              {content.metaDescription.length} / 160
                          </span>
                      </div>
                      <textarea 
                        value={content.metaDescription}
                        onChange={(e) => handleChange('metaDescription', e.target.value)}
                        className="w-full h-20 p-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none resize-none"
                      />
                  </div>
              </div>
          </div>

          {/* Content Body */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
               <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
                  <AlignRight size={16} />
                  محتوای صفحه
              </h3>

              <div className="space-y-6">
                  {/* Category Desc (Top) */}
                  <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {siteType === 'Shop' ? 'توضیحات دسته‌بندی (Category Description)' : 'خلاصه / مقدمه (Intro)'}
                      </label>
                      <textarea 
                        value={content.categoryDescription}
                        onChange={(e) => handleChange('categoryDescription', e.target.value)}
                        className="w-full h-24 p-3 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none"
                      />
                  </div>

                  {/* Main Content */}
                  <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                         محتوای اصلی (HTML Body)
                      </label>
                      <div className="relative">
                        <textarea 
                            value={content.mainContent}
                            onChange={(e) => handleChange('mainContent', e.target.value)}
                            className="w-full h-64 p-3 border border-gray-300 rounded-lg text-sm font-mono text-gray-700 focus:border-blue-500 outline-none leading-relaxed"
                            dir="ltr"
                        />
                        <div className="absolute top-2 right-2 bg-gray-100 text-gray-500 text-[10px] px-2 py-1 rounded">HTML Mode</div>
                      </div>
                  </div>
              </div>
          </div>

          {/* Products (If Shop) */}
          {siteType === 'Shop' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
                      <ShoppingBag size={16} />
                      محصولات پیشنهادی برای لینک‌سازی
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {content.suggestedProducts.map((prod, idx) => (
                          <div key={idx} className="flex gap-2">
                              <input 
                                type="text" 
                                value={prod}
                                onChange={(e) => handleProductChange(idx, e.target.value)}
                                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none"
                                placeholder={`محصول ${idx + 1}`}
                              />
                              <button 
                                onClick={() => removeProductSlot(idx)}
                                className="text-red-400 hover:text-red-600 px-2"
                              >
                                  &times;
                              </button>
                          </div>
                      ))}
                      <button 
                        onClick={addProductSlot}
                        className="border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-blue-400 hover:text-blue-500 text-sm font-medium p-2 transition-colors"
                      >
                          + افزودن محصول
                      </button>
                  </div>
              </div>
          )}

      </div>
    </div>
  );
}