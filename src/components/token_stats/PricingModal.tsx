import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DollarSign, X, RotateCcw, Plus, Trash2, Search, Sparkles } from 'lucide-react';
import { ModelPricingRule, DEFAULT_PRICING } from '../../pages/TokenStats';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentPricing: Record<string, ModelPricingRule>;
    onSave: (pricing: Record<string, ModelPricingRule>) => void;
}

type ModelCategory = 'all' | 'gemini' | 'claude' | 'openai' | 'other';

export const PricingModal: React.FC<PricingModalProps> = ({
    isOpen,
    onClose,
    currentPricing,
    onSave,
}) => {
    const { t } = useTranslation();
    const [tempPricing, setTempPricing] = useState<Record<string, ModelPricingRule>>(currentPricing);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<ModelCategory>('all');
    const [newModelName, setNewModelName] = useState('');
    const [newInputPrice, setNewInputPrice] = useState('1.00');
    const [newOutputPrice, setNewOutputPrice] = useState('5.00');
    const [newCachePrice, setNewCachePrice] = useState('0.10');

    useEffect(() => {
        if (isOpen) {
            setTempPricing(currentPricing);
            setSearchQuery('');
            setSelectedCategory('all');
        }
    }, [isOpen, currentPricing]);

    const getModelCategory = (name: string): 'gemini' | 'claude' | 'openai' | 'other' => {
        const lower = name.toLowerCase();
        if (lower.startsWith('gemini')) return 'gemini';
        if (lower.startsWith('claude') || lower.startsWith('fable') || lower.startsWith('mythos')) return 'claude';
        if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'openai';
        return 'other';
    };

    const getProviderBadge = (category: string) => {
        switch (category) {
            case 'gemini':
                return (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
                        Google
                    </span>
                );
            case 'claude':
                return (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                        Claude
                    </span>
                );
            case 'openai':
                return (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                        OpenAI
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20 shrink-0">
                        Global
                    </span>
                );
        }
    };

    const filteredPricingList = useMemo(() => {
        return Object.entries(tempPricing).filter(([mName]) => {
            const matchesSearch = searchQuery.trim() === '' || mName.toLowerCase().includes(searchQuery.trim().toLowerCase());
            if (!matchesSearch) return false;
            if (selectedCategory === 'all') return true;
            return getModelCategory(mName) === selectedCategory;
        });
    }, [tempPricing, searchQuery, selectedCategory]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
            {/* 半透明遮罩层 */}
            <div
                className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* 模态框主体卡片 */}
            <div className="relative z-10 bg-white dark:bg-[#181a20] text-gray-900 dark:text-gray-100 rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200/90 dark:border-white/10 flex flex-col h-[82vh] max-h-[750px] min-h-[500px] transition-all animate-in fade-in zoom-in-95 duration-200">
                {/* 顶部标题区 */}
                <div className="flex items-center justify-between pb-3.5 border-b border-gray-200/80 dark:border-white/10 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 shadow-sm">
                            <DollarSign className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                {t('token_stats.pricing_settings', '模型价格配置 ($/1M Tokens)')}
                            </h3>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {t('token_stats.pricing_snapshot_hint', '基于当前单价快照加权累计，自动匹配分档后缀')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 搜索与分类筛选栏 */}
                <div className="pt-3 pb-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
                    {/* 分类快捷药丸 */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                        {(['all', 'gemini', 'claude', 'openai', 'other'] as ModelCategory[]).map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                    selectedCategory === cat
                                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 font-semibold'
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                                }`}
                            >
                                {cat === 'all' && t('token_stats.all_families', '全部')}
                                {cat === 'gemini' && 'Gemini'}
                                {cat === 'claude' && 'Claude'}
                                {cat === 'openai' && 'OpenAI'}
                                {cat === 'other' && t('token_stats.other_models', '其他')}
                            </button>
                        ))}
                    </div>

                    {/* 搜索框 */}
                    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder={t('token_stats.search_model', '搜索模型名称或标识...')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-white/10 transition-colors"
                        />
                    </div>
                </div>

                {/* 表头 */}
                <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 border-b border-gray-100 dark:border-white/5 uppercase tracking-wider shrink-0">
                    <div className="col-span-5">{t('token_stats.model_pattern_label', '模型匹配标识')}</div>
                    <div className="col-span-2 text-right">{t('token_stats.input_price_label', '输入 ($/1M)')}</div>
                    <div className="col-span-2 text-right">{t('token_stats.output_price_label', '输出 ($/1M)')}</div>
                    <div className="col-span-2 text-right">{t('token_stats.cache_price_label', '缓存 ($/1M)')}</div>
                    <div className="col-span-1 text-center">{t('token_stats.actions', '操作')}</div>
                </div>

                {/* 规则可滚动列表 */}
                <div className="overflow-y-auto flex-1 min-h-0 my-2 space-y-1.5 pr-1.5 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
                    {filteredPricingList.length === 0 ? (
                        <div className="py-12 text-center text-xs text-gray-400 dark:text-gray-500">
                            {t('token_stats.search_no_results', '未找到匹配的模型规则')}
                        </div>
                    ) : (
                        filteredPricingList.map(([mName, rule]) => {
                            const cat = getModelCategory(mName);
                            return (
                                <div
                                    key={mName}
                                    className="grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-xl bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/70 dark:border-white/[0.06] text-xs hover:border-gray-300 dark:hover:border-white/20 transition-colors"
                                >
                                    <div className="col-span-5 flex items-center gap-1.5 min-w-0" title={mName}>
                                        {getProviderBadge(cat)}
                                        <span className="font-mono text-[11px] font-medium text-gray-900 dark:text-gray-200 truncate">
                                            {mName}
                                        </span>
                                    </div>
                                    <div className="col-span-2">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={rule.input}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setTempPricing((prev) => ({
                                                    ...prev,
                                                    [mName]: { ...prev[mName], input: val },
                                                }));
                                            }}
                                            className="w-full text-right px-2 py-1 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-lg text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={rule.output}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setTempPricing((prev) => ({
                                                    ...prev,
                                                    [mName]: { ...prev[mName], output: val },
                                                }));
                                            }}
                                            className="w-full text-right px-2 py-1 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-lg text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <input
                                            type="number"
                                            step="0.001"
                                            value={rule.cached}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setTempPricing((prev) => ({
                                                    ...prev,
                                                    [mName]: { ...prev[mName], cached: val },
                                                }));
                                            }}
                                            className="w-full text-right px-2 py-1 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-lg text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        {mName !== 'default' ? (
                                            <button
                                                onClick={() => {
                                                    const next = { ...tempPricing };
                                                    delete next[mName];
                                                    setTempPricing(next);
                                                }}
                                                className="text-red-400 hover:text-red-600 dark:text-red-400/80 dark:hover:text-red-400 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                                title={t('token_stats.delete', '删除')}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        ) : (
                                            <span className="text-[10px] text-gray-400 select-none">默认</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* 添加新规则栏（吸底并保持常驻可见） */}
                <div className="p-3 rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-gray-50/50 dark:bg-white/[0.02] mt-2 space-y-2 shrink-0">
                    <div className="text-[11px] font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                        {t('token_stats.add_custom_pricing', '添加自定义模型规则')}
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-center">
                        <input
                            type="text"
                            placeholder={t('token_stats.model_pattern_placeholder', '模型匹配标识 (如 gemini-4-argon, claude-opus-5-5)')}
                            value={newModelName}
                            onChange={(e) => setNewModelName(e.target.value)}
                            className="col-span-5 px-3 py-1.5 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-xl text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                        />
                        <input
                            type="number"
                            step="0.01"
                            placeholder={t('token_stats.input', '输入')}
                            value={newInputPrice}
                            onChange={(e) => setNewInputPrice(e.target.value)}
                            className="col-span-2 text-right px-2 py-1.5 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-xl text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <input
                            type="number"
                            step="0.01"
                            placeholder={t('token_stats.output', '输出')}
                            value={newOutputPrice}
                            onChange={(e) => setNewOutputPrice(e.target.value)}
                            className="col-span-2 text-right px-2 py-1.5 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-xl text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <input
                            type="number"
                            step="0.001"
                            placeholder={t('token_stats.cached', '缓存')}
                            value={newCachePrice}
                            onChange={(e) => setNewCachePrice(e.target.value)}
                            className="col-span-2 text-right px-2 py-1.5 bg-white dark:bg-black/30 border border-gray-300/80 dark:border-white/10 rounded-xl text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                            onClick={() => {
                                if (!newModelName.trim()) return;
                                const k = newModelName.trim().toLowerCase();
                                setTempPricing((prev) => ({
                                    ...prev,
                                    [k]: {
                                        input: parseFloat(newInputPrice) || 0,
                                        output: parseFloat(newOutputPrice) || 0,
                                        cached: parseFloat(newCachePrice) || 0,
                                    },
                                }));
                                setNewModelName('');
                            }}
                            className="col-span-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium flex items-center justify-center transition-colors shadow-sm shadow-emerald-600/30"
                            title={t('token_stats.add', '添加')}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* 底部按钮栏（固定常驻可见） */}
                <div className="flex items-center justify-between pt-3.5 border-t border-gray-200/80 dark:border-white/10 shrink-0">
                    <button
                        onClick={() => {
                            setTempPricing(DEFAULT_PRICING);
                            setSearchQuery('');
                            setSelectedCategory('all');
                        }}
                        className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white flex items-center gap-1.5 border border-gray-300/80 dark:border-white/10 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t('token_stats.reset_pricing', '恢复默认')}
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors"
                        >
                            {t('token_stats.cancel', '取消')}
                        </button>
                        <button
                            onClick={() => onSave(tempPricing)}
                            className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md shadow-emerald-600/30 transition-colors"
                        >
                            {t('token_stats.save_pricing', '保存配置')}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
