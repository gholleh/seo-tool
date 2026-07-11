import React, { useState } from 'react';
import KeywordFetcher from './components/KeywordFetcher';
import KeywordClusterer from './components/KeywordClusterer';
import AiClusterRefiner from './components/AiClusterRefiner';
import ContentGenerator from './components/ContentGenerator';
import OffpageAnalyzer from './components/OffpageAnalyzer';
import { Search, Layers, BrainCircuit, FileText, BarChart3 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'fetcher' | 'clusterer' | 'refiner' | 'content' | 'offpage'>('fetcher');

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans" dir="rtl">
      
      {/* Top Navigation */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center py-4">
             <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg text-white shadow-md transition-colors ${
                    activeTab === 'fetcher' ? 'bg-blue-600' : 
                    activeTab === 'clusterer' ? 'bg-green-600' : 
                    activeTab === 'refiner' ? 'bg-purple-600' : 
                    activeTab === 'content' ? 'bg-amber-500' : 'bg-teal-600'
                }`}>
                  {activeTab === 'fetcher' ? <Search size={24} /> : 
                   activeTab === 'clusterer' ? <Layers size={24} /> : 
                   activeTab === 'refiner' ? <BrainCircuit size={24} /> : 
                   activeTab === 'content' ? <FileText size={24} /> : <BarChart3 size={24} />}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">SEO Toolkit Pro</h1>
                  <p className="text-xs text-gray-500">ابزارهای حرفه‌ای تحقیق کلمات کلیدی + هوش مصنوعی</p>
                </div>
              </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 mt-2 overflow-x-auto">
            <button 
              onClick={() => setActiveTab('fetcher')}
              className={`pb-3 px-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'fetcher' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ۱. استخراج و فیلتر (Deep Suggest)
              {activeTab === 'fetcher' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full"></div>
              )}
            </button>

            <button 
              onClick={() => setActiveTab('clusterer')}
              className={`pb-3 px-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'clusterer' ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ۲. خوشه‌بندی اولیه (SERP Cluster)
              {activeTab === 'clusterer' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600 rounded-t-full"></div>
              )}
            </button>

            <button 
              onClick={() => setActiveTab('refiner')}
              className={`pb-3 px-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'refiner' ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ۳. معماری محتوا (AI Refiner & MindMap)
              {activeTab === 'refiner' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full"></div>
              )}
            </button>

            <button 
              onClick={() => setActiveTab('content')}
              className={`pb-3 px-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'content' ? 'text-amber-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ۴. تولید محتوا (Content Generator)
              {activeTab === 'content' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-600 rounded-t-full"></div>
              )}
            </button>

            <button 
              onClick={() => setActiveTab('offpage')}
              className={`pb-3 px-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'offpage' ? 'text-teal-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ۵. بررسی آف پیج (Off-Page)
              {activeTab === 'offpage' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-t-full"></div>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div style={{ display: activeTab === 'fetcher' ? 'block' : 'none' }}>
          <KeywordFetcher />
        </div>
        <div style={{ display: activeTab === 'clusterer' ? 'block' : 'none' }}>
          <KeywordClusterer />
        </div>
        <div style={{ display: activeTab === 'refiner' ? 'block' : 'none' }}>
          <AiClusterRefiner />
        </div>
        <div style={{ display: activeTab === 'content' ? 'block' : 'none' }}>
          <ContentGenerator />
        </div>
        <div style={{ display: activeTab === 'offpage' ? 'block' : 'none' }}>
          <OffpageAnalyzer />
        </div>
      </main>

    </div>
  );
}