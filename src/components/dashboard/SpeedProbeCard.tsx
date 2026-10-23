import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { request as invoke } from '../../utils/request';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../../utils/env';
import {
    formatDurationMs,
    formatTimeAgo,
    OneMinuteLoadMetrics,
} from '../../utils/speedProbeLogSync';
import { FishMoyuIcon } from './FishMoyuIcon';

export interface ProbeModelInfo {
    id: string;
    name: string;
    vendor: string;
    source: string;
    category?: string;
    tag?: string;
    tokens_display?: string;
    mapped_to?: string;
}

const LOCAL_STORAGE_KEY = 'antigravity_last_rolling_load_result';

export function SpeedProbeCard() {
    const [dynamicTargets, setDynamicTargets] = useState<ProbeModelInfo[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [isManualLocked, setIsManualLocked] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [metrics, setMetrics] = useState<OneMinuteLoadMetrics | null>(() => {
        try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return null;
    });

    // 动态拉取当前系统按实际使用量降序排列的模型列表
    useEffect(() => {
        invoke<ProbeModelInfo[]>('get_probe_model_targets')
            .then((targets) => {
                if (targets && targets.length > 0) {
                    setDynamicTargets(targets);
                }
            })
            .catch((e) => console.error('[SpeedProbe] Failed to fetch models:', e));
    }, []);

    // 核心函数：拉取前 1 分钟滑动负载窗口统计指标 (未手动锁定时，传 null 自动感知当前正在调用的活跃模型)
    const fetchRollingLoad = useCallback(async (forcedModel?: string) => {
        try {
            const modelToQuery = forcedModel !== undefined
                ? (forcedModel.trim() || null)
                : (isManualLocked && selectedModel ? selectedModel : null);

            const res = await invoke<OneMinuteLoadMetrics>('get_one_minute_load', {
                model: modelToQuery,
            });
            if (res) {
                setMetrics(res);
                // 自动跟随模式：未手动锁定时，胶囊自动同步为当前真实调用模型
                if (!isManualLocked && res.model) {
                    setSelectedModel(res.model);
                }
                try {
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(res));
                } catch (e) {}
            }
        } catch (err) {
            console.debug('[SpeedProbe] Failed to fetch rolling load:', err);
        }
    }, [isManualLocked, selectedModel]);

    // 主动即刻测速
    const handleProbe = useCallback(async (modelId?: string) => {
        const targetModel = (modelId || selectedModel || metrics?.model || 'gemini-3.8-flash-high').trim();
        setLoading(true);
        try {
            await invoke('run_speed_probe', {
                model: targetModel,
                accountEmail: null,
            });
            await fetchRollingLoad(targetModel);
        } catch (error: any) {
            console.error('[SpeedProbe] Probe failed:', error);
            await fetchRollingLoad(targetModel);
        } finally {
            setLoading(false);
        }
    }, [selectedModel, metrics?.model, fetchRollingLoad]);

    // 核心优化 1：初次载入立即刷新前 1 分钟负载
    useEffect(() => {
        fetchRollingLoad();
    }, [fetchRollingLoad]);

    // 核心优化 2：每 4 秒自动滑动更新 1 分钟窗口 (请求停止后自动无缝归于待机状态)
    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchRollingLoad();
        }, 4000);
        return () => clearInterval(intervalId);
    }, [fetchRollingLoad]);

    // 核心优化 3：持续监听真实代理请求日志，每当有请求完成即刻触发 1 分钟窗口聚合重算并动态跟随模型
    useEffect(() => {
        if (!isTauri()) return;
        let unlistenFn: (() => void) | null = null;
        const setupLogListener = async () => {
            try {
                unlistenFn = await listen<any>('proxy://request', (event) => {
                    const log = event.payload;
                    if (!log || typeof log.duration !== 'number') return;
                    if (log.model && !isManualLocked) {
                        setSelectedModel(log.model);
                    }
                    fetchRollingLoad();
                });
            } catch (e) {
                console.debug('[SpeedProbe] Live log listener skipped:', e);
            }
        };

        setupLogListener();
        return () => {
            if (unlistenFn) unlistenFn();
        };
    }, [fetchRollingLoad, isManualLocked]);

    // 智能分组模型列表：今日活跃、长期Top3、前沿新模型(Gemini 4 / Claude 5.5)、账号原生、自定义
    const groupedOptions = useMemo(() => {
        const groups: { category: string; items: ProbeModelInfo[] }[] = [];
        const groupMap = new Map<string, ProbeModelInfo[]>();

        for (const target of dynamicTargets) {
            const cat = target.category || '💎 账号原生可用';
            if (!groupMap.has(cat)) {
                groupMap.set(cat, []);
            }
            groupMap.get(cat)!.push(target);
        }

        // 预设推荐分组顺序
        const orderedCategories = [
            '🌟 今日最活跃 (近24小时)',
            '🏆 长期主力 Top 3',
            '🚀 前沿新模型 (账号已激活)',
            '💎 账号原生可用',
            '⚙️ 自定义接口映射',
        ];

        for (const cat of orderedCategories) {
            if (groupMap.has(cat)) {
                groups.push({ category: cat, items: groupMap.get(cat)! });
                groupMap.delete(cat);
            }
        }
        for (const [cat, items] of groupMap.entries()) {
            groups.push({ category: cat, items });
        }

        return groups;
    }, [dynamicTargets]);

    const isIdle = !metrics || metrics.is_idle;

    const getSlackTheme = (level?: string, idle?: boolean) => {
        if (idle) {
            return {
                badgeBg: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20',
                progressColor: 'from-zinc-400 to-zinc-500',
                textColor: 'text-zinc-500 dark:text-zinc-400',
            };
        }
        switch (level) {
            case 'sprint':
                return {
                    badgeBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                    progressColor: 'from-emerald-500 to-teal-400',
                    textColor: 'text-emerald-600 dark:text-emerald-400',
                };
            case 'smooth':
                return {
                    badgeBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
                    progressColor: 'from-blue-500 to-indigo-400',
                    textColor: 'text-blue-600 dark:text-blue-400',
                };
            case 'tea':
                return {
                    badgeBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
                    progressColor: 'from-amber-500 to-orange-400',
                    textColor: 'text-amber-600 dark:text-amber-400',
                };
            case 'slack':
            default:
                return {
                    badgeBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20',
                    progressColor: 'from-rose-500 to-red-400',
                    textColor: 'text-rose-600 dark:text-rose-400',
                };
        }
    };

    const theme = getSlackTheme(metrics?.slack_level, isIdle);

    return (
        <div className="bg-white/95 dark:bg-[#15161b] rounded-2xl px-4 py-2.5 shadow-sm dark:shadow-lg dark:shadow-black/30 border border-gray-150 dark:border-white/[0.08] relative overflow-hidden transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                {/* 左翼：摸鱼小鱼 + 状态标语 + 摸鱼指数 + 1分钟负载吞吐 */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* 灵动摸鱼小鱼 (摇尾巴吐泡泡) */}
                    <FishMoyuIcon level={isIdle ? 'idle' : metrics?.slack_level} className="w-6 h-6 shrink-0" />

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900 dark:text-zinc-100 truncate">
                                {metrics?.slack_title || '前1分钟服务负载计算中...'}
                            </span>

                            {/* 摸鱼指数胶囊 */}
                            <span className={`text-[10px] px-2 py-0.2 rounded-full font-mono font-bold border shrink-0 ${theme.badgeBg}`}>
                                {isIdle ? '待机空闲' : `摸鱼指数 ${metrics?.slack_score ?? 0}%`}
                            </span>

                            {/* 1分钟请求频次 RPM 标识 */}
                            {metrics && metrics.request_count > 0 && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-md font-mono bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
                                    {metrics.request_count} req/min
                                </span>
                            )}

                            {/* 状态时效 */}
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-mono shrink-0">
                                {isIdle ? (metrics?.last_active_timestamp ? formatTimeAgo(metrics.last_active_timestamp) : '待命中') : '近1分钟'}
                            </span>
                        </div>

                        {/* 趣味指导文案与极简微进度条 */}
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-24 sm:w-32 bg-gray-100 dark:bg-white/[0.08] h-1.5 rounded-full overflow-hidden shrink-0">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: isIdle ? '0%' : `${metrics?.slack_score ?? 0}%` }}
                                    transition={{ duration: 0.5, ease: 'easeOut' }}
                                    className={`h-full bg-gradient-to-r ${theme.progressColor}`}
                                />
                            </div>
                            <span className="text-[11px] text-gray-500 dark:text-zinc-400 truncate font-sans">
                                {metrics?.slack_advice || '持续监测上游接口服务负载与排队状况。'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 右翼：三大真实数字指标 + 唯一主力模型胶囊 + 测速按钮 */}
                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                    {/* 三大极简紧凑数字指标 (前1分钟平均真实首字、真实生成速率、真实平均链路) */}
                    <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-150 dark:border-white/[0.06] text-center font-mono">
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">首字</div>
                            <div className={`text-xs font-bold leading-tight mt-0.5 ${theme.textColor}`}>
                                {loading ? '...' : isIdle ? '—' : formatDurationMs(metrics?.avg_ttft_ms)}
                            </div>
                        </div>
                        <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08]" />
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">速率</div>
                            <div className="text-xs font-bold leading-tight text-gray-800 dark:text-zinc-200 mt-0.5">
                                {loading ? '...' : isIdle ? '0.0' : `${metrics?.tps ?? 0}`}
                            </div>
                        </div>
                        <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08]" />
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">链路</div>
                            <div className="text-xs font-bold leading-tight text-gray-800 dark:text-zinc-200 mt-0.5">
                                {loading ? '...' : isIdle ? '—' : formatDurationMs(metrics?.avg_duration_ms)}
                            </div>
                        </div>
                    </div>

                    {/* 纯正主力模型选择胶囊 (智能分组：今日活跃、长期Top3、Gemini 4新模型、账号原生，并标注底层转接模型) */}
                    <div className="flex items-center bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200/60 dark:hover:bg-white/[0.1] px-2 py-1 rounded-xl border border-gray-200/70 dark:border-white/[0.1] text-xs font-mono transition-all">
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${isManualLocked ? 'bg-amber-400' : 'bg-cyan-400 animate-pulse'}`} />
                        <select
                            value={selectedModel || metrics?.model || (dynamicTargets[0]?.id ?? 'gemini-3.8-flash-high')}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '__auto__') {
                                    setIsManualLocked(false);
                                    fetchRollingLoad('');
                                } else {
                                    setIsManualLocked(true);
                                    setSelectedModel(val);
                                    handleProbe(val);
                                }
                            }}
                            className="bg-transparent text-xs font-bold text-gray-800 dark:text-cyan-300 outline-none cursor-pointer pr-1 max-w-[210px]"
                            title={
                                isManualLocked
                                    ? `手动锁定模型: ${selectedModel}`
                                    : metrics?.mapped_model && metrics.mapped_model !== metrics.model
                                        ? `前置入口: ${metrics.model} ➔ 底层物理承载: ${metrics.mapped_model}`
                                        : `当前自动跟随实际调用模型: ${metrics?.model || selectedModel}`
                            }
                        >
                            <option value="__auto__" className="dark:bg-[#15161b] text-cyan-500 font-bold">
                                ⚡ 自动感知 ({metrics?.display_name || metrics?.model || selectedModel || '跟随调用'})
                            </option>
                            {groupedOptions.map((group) => (
                                <optgroup key={group.category} label={group.category} className="dark:bg-[#15161b] text-gray-400 font-semibold text-[11px]">
                                    {group.items.map((t, idx) => {
                                        const isCurrentActive = t.id === metrics?.model;
                                        const mappedArrow = t.mapped_to && t.mapped_to !== t.id ? ` ➔ ${t.mapped_to}` : '';
                                        const activeLabel = isCurrentActive ? ' ★ 当前调用' : '';
                                        const tagLabel = t.tag ? ` [${t.tag}]` : '';
                                        const label = `${t.id}${mappedArrow}${tagLabel}${activeLabel}`;
                                        return (
                                            <option key={`${group.category}-${t.id}-${idx}`} value={t.id} className="dark:bg-[#15161b] text-gray-900 dark:text-zinc-100 font-normal">
                                                {label}
                                            </option>
                                        );
                                    })}
                                </optgroup>
                            ))}
                        </select>
                        {/* 若存在转接模型，在胶囊右侧显示醒目的底层映射提示 */}
                        {metrics?.mapped_model && metrics.mapped_model !== (metrics.model || selectedModel) && (
                            <span
                                className="text-[10px] text-teal-600 dark:text-cyan-400 font-mono hidden lg:inline truncate max-w-[140px] border-l border-gray-200 dark:border-white/10 pl-1.5"
                                title={`前置入口: ${metrics.model} ➔ 底层转接模型: ${metrics.mapped_model}`}
                            >
                                ➔ {metrics.mapped_model}
                            </span>
                        )}
                    </div>

                    {/* 测速动作按钮 */}
                    <button
                        type="button"
                        onClick={() => handleProbe()}
                        disabled={loading}
                        className={`px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/30 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer shrink-0 ${
                            loading ? 'opacity-70 cursor-not-allowed' : ''
                        }`}
                        title="对主力模型执行即时链路测速"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        <span>{loading ? '测速中' : '即刻测速'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
