import React, { useState } from 'react';
import { 
  FileText, 
  Sparkles, 
  RefreshCw, 
  Loader2, 
  AlignRight, 
  Link as LinkIcon, 
  ShoppingBag
} from 'lucide-react';
// مسیر ایمپورت را دقیق تر بررسی می کنیم
import { generatePageContent } from '../services/geminiService';

interface GeneratedContent {
  pageTitle: string;
  urlSlug: string;
  metaDescription: string;
  mainContent: string;
  categoryDescription: string;
  suggestedProducts: string[];
}

export default function ContentGenerator() {
  const [keywords, setKeywords] = useState<string>('');
  const [siteType, setSiteType] = useState<'Shop' | 'Blog'>('Shop');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  
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
    
    // اینجا متغیر محیطی را به صورت امن چک می کنیم
    // اگر در آینده متغیر را ست نکردید، فقط لاگ می اندازد و بیلد را خراب نمی کند
    if (!import.meta.env.VITE_GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
       console.warn("API Key تنظیم نشده است.");
    }

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-120px)]">
      {/* بخش ورودی و بقیه کدها را به همان شکلی که بود حفظ کردم */}
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
                  className="w-full h-40 p-3 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-amber-500"
               />
             </div>
             <button 
               onClick={handleGenerate}
               disabled={isGenerating}
               className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white py-2.5 rounded-lg"
             >
               {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
               <span>تولید محتوا با AI</span>
             </button>
           </div>
        </div>
      </div>
      {/* ... ادامه بدنه اصلی کد شما ... */}
    </div>
  );
}
