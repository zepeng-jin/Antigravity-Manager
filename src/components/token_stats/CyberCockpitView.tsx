import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
    AlertTriangle,
    ArrowUpRight,
    Flame,
    Clock,
    Zap,
    Scale,
    RefreshCw,
} from 'lucide-react';
import { HourlyUsagePoint } from './HourlyTrendBarCard';
import { ModelShareItem } from './TopModelsShareCard';
import { AccountTokenStats } from '../../pages/TokenStats';
import { request as invoke } from '../../utils/request';
import { UserTokenStatsModal, UserTokenSummaryItem } from '../user_tokens/UserTokenStatsModal';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../../utils/env';
import { formatDurationMs } from '../../utils/speedProbeLogSync';

interface TokenStatsSummary {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cached_tokens: number;
    total_reasoning_tokens?: number;
    total_tokens: number;
    total_requests: number;
    unique_accounts: number;
}

interface CyberCockpitViewProps {
    summary: TokenStatsSummary | null;
    hourlyData: HourlyUsagePoint[];
    timelineData?: any[];
    modelShareItems: ModelShareItem[];
    accountData: AccountTokenStats[];
    timeRange: 'minute' | 'hourly' | 'daily' | 'weekly' | 'all';
    totalEstimatedCost: number;
    cacheMetrics: { hitRate: number; savings: number };
    formatNumber: (n: number) => string;
    formatCurrency: (n: number) => string;
    setShowPricingModal: (s: boolean) => void;
}

export interface UserTokenRankItem {
    id: string;
    token: string;
    username: string;
    description?: string | null;
    enabled: boolean;
    expires_type: string;
    expires_at?: number | null;
    max_ips: number;
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    requests: number;
    percentage: number;
}

const MODEL_NEON_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4'];

export const CyberCockpitView: React.FC<CyberCockpitViewProps> = ({
    summary,
    hourlyData = [],
    modelShareItems = [],
    accountData = [],
    timeRange,
    totalEstimatedCost,
    cacheMetrics,
    formatNumber,
    formatCurrency: _formatCurrency,
    setShowPricingModal,
}) => {
    const { t } = useTranslation();
    const [rightTab, setRightTab] = useState<'accounts' | 'models' | 'users'>('accounts');
    const [selectedModelIdx, setSelectedModelIdx] = useState<number | null>(null);
    const [hoveredHourIdx, setHoveredHourIdx] = useState<number | null>(null);
    const [userTokensRank, setUserTokensRank] = useState<UserTokenRankItem[]>([]);
    const [userTokensLoading, setUserTokensLoading] = useState<boolean>(false);
    const [selectedUserToken, setSelectedUserToken] = useState<UserTokenSummaryItem | null>(null);
    const [showUserTokenModal, setShowUserTokenModal] = useState<boolean>(false);

    // 实时速度探测与前1分钟服务负载状态 (与首页大盘完全打通联动)
    const [loadMetrics, setLoadMetrics] = useState<any>(() => {
        try {
            const saved = localStorage.getItem('antigravity_last_rolling_load_result');
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return null;
    });
    const [isProbing, setIsProbing] = useState<boolean>(false);
    const [targetModel, setTargetModel] = useState<string>('gemini-3.8-flash-high');

    useEffect(() => {
        if (modelShareItems && modelShareItems.length > 0 && modelShareItems[0]?.model) {
            setTargetModel(modelShareItems[0].model);
        }
    }, [modelShareItems]);

    // 车速表指针动态平滑弹射动效 (60FPS 三角函数绝对锚定，彻底解决指针脱离中心与指错位置问题)
    const [animatedRate, setAnimatedRate] = useState<number>(0);
    useEffect(() => {
        let current = 0;
        const target = Math.min(100, Math.max(0, cacheMetrics.hitRate));
        let frameId: number;
        const animate = () => {
            current += (target - current) * 0.16;
            if (Math.abs(target - current) < 0.15) {
                setAnimatedRate(target);
            } else {
                setAnimatedRate(current);
                frameId = requestAnimationFrame(animate);
            }
        };
        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, [cacheMetrics.hitRate]);

    const needleAngleRad = useMemo(() => {
        return Math.PI + (animatedRate / 100) * Math.PI;
    }, [animatedRate]);

    const needleCoords = useMemo(() => {
        const cx = 110;
        const cy = 92;
        const len = 64;
        const tailLen = 12;
        const halfWidth = 2.6;

        const tipX = cx + len * Math.cos(needleAngleRad);
        const tipY = cy + len * Math.sin(needleAngleRad);
        const tailX = cx - tailLen * Math.cos(needleAngleRad);
        const tailY = cy - tailLen * Math.sin(needleAngleRad);

        const perpX = -Math.sin(needleAngleRad) * halfWidth;
        const perpY = Math.cos(needleAngleRad) * halfWidth;

        const p1X = cx + perpX;
        const p1Y = cy + perpY;
        const p2X = cx - perpX;
        const p2Y = cy - perpY;

        return {
            tipX,
            tipY,
            points: `${tipX},${tipY} ${p1X},${p1Y} ${tailX},${tailY} ${p2X},${p2Y}`,
        };
    }, [needleAngleRad]);

    // 初次载入时，优先从真实网关日志同步前1分钟滑动负载 (与大盘完全联动一致)
    useEffect(() => {
        invoke<any>('get_one_minute_load', { model: null })
            .then((load) => {
                if (load) {
                    setLoadMetrics(load);
                    if (load.model) setTargetModel(load.model);
                    try {
                        localStorage.setItem('antigravity_last_rolling_load_result', JSON.stringify(load));
                    } catch (e) {}
                }
            })
            .catch(() => {
                invoke<any>('get_latest_real_speed')
                    .then((latest) => {
                        if (latest) {
                            setLoadMetrics(latest);
                            if (latest.model) setTargetModel(latest.model);
                        }
                    })
                    .catch(() => {});
            });
    }, []);

    // 核心优化：监听真实网关调用日志，实时同步前1分钟负载与速度
    useEffect(() => {
        if (!isTauri()) return;
        let unlistenFn: (() => void) | null = null;
        const setupLogListener = async () => {
            try {
                unlistenFn = await listen<any>('proxy://request', (event) => {
                    const log = event.payload;
                    if (!log || typeof log.duration !== 'number' || log.duration <= 0) return;
                    invoke<any>('get_one_minute_load', { model: log.model || targetModel })
                        .then((load) => {
                            if (load) {
                                setLoadMetrics(load);
                                if (load.model) setTargetModel(load.model);
                                try {
                                    localStorage.setItem('antigravity_last_rolling_load_result', JSON.stringify(load));
                                } catch (e) {}
                            }
                        })
                        .catch(() => {});
                });
            } catch (e) {
                console.debug('[CyberCockpit] Log listener setup skipped:', e);
            }
        };

        setupLogListener();
        return () => {
            if (unlistenFn) unlistenFn();
        };
    }, [targetModel]);

    const handleRunProbe = useCallback(async (modelToTest?: string) => {
        const m = (modelToTest || targetModel).trim();
        if (!m) return;
        setIsProbing(true);
        try {
            await invoke<any>('run_speed_probe', { model: m, accountEmail: null });
            const latestLoad = await invoke<any>('get_one_minute_load', { model: m });
            if (latestLoad) {
                setLoadMetrics(latestLoad);
                try {
                    localStorage.setItem('antigravity_last_rolling_load_result', JSON.stringify(latestLoad));
                } catch (e) {}
            }
        } catch (e) {
            console.error('[CyberCockpit] Probe error:', e);
        } finally {
            setIsProbing(false);
        }
    }, [targetModel]);

    // 获取用户 Token 消耗排行榜数据
    useEffect(() => {
        let isMounted = true;
        const fetchUserRankings = async () => {
            try {
                setUserTokensLoading(true);
                const res = await invoke<UserTokenRankItem[]>('get_user_tokens_ranking', {
                    timeRange,
                    time_range: timeRange,
                });
                if (isMounted && Array.isArray(res)) {
                    setUserTokensRank(res);
                }
            } catch (e) {
                console.error('Failed to fetch user tokens ranking:', e);
            } finally {
                if (isMounted) {
                    setUserTokensLoading(false);
                }
            }
        };
        fetchUserRankings();
        return () => {
            isMounted = false;
        };
    }, [timeRange, summary]);

    // 1. 输入输出比例与生成比
    const inOutRatio = useMemo(() => {
        if (!summary || summary.total_tokens === 0) return { inPct: 50, outPct: 50, inOutMultiplier: '1.0' };
        const total = summary.total_input_tokens + summary.total_output_tokens;
        if (total === 0) return { inPct: 50, outPct: 50, inOutMultiplier: '1.0' };
        const inPct = Math.round((summary.total_input_tokens / total) * 100);
        const mult = summary.total_output_tokens > 0
            ? (summary.total_input_tokens / summary.total_output_tokens).toFixed(1)
            : '0.0';
        return { inPct, outPct: 100 - inPct, inOutMultiplier: mult };
    }, [summary]);

    // 2. 均次负载与真实未缓存输入
    const deepMetrics = useMemo(() => {
        const totalReqs = summary?.total_requests || 1;
        const totalTokens = summary?.total_tokens || 0;
        const totalInput = summary?.total_input_tokens || 0;
        const totalOutput = summary?.total_output_tokens || 0;
        const totalCached = summary?.total_cached_tokens || 0;
        const totalReasoning = summary?.total_reasoning_tokens || 0;

        const avgTokensPerReq = Math.round(totalTokens / totalReqs);
        const uncachedInput = Math.max(0, totalInput - totalCached);
        const avgCostPerReq = totalReqs > 0 ? totalEstimatedCost / totalReqs : 0;
        const reasoningPctOfOutput = totalOutput > 0 ? Math.round((totalReasoning / totalOutput) * 100) : 0;
        const avgReasoningPerReq = Math.round(totalReasoning / totalReqs);

        return {
            avgTokensPerReq,
            uncachedInput,
            avgCostPerReq,
            totalReasoning,
            reasoningPctOfOutput,
            avgReasoningPerReq,
        };
    }, [summary, totalEstimatedCost]);

    // 3. 核心模型分布及 360 度辐射彩针计算
    const { topModels, radialNeedles } = useMemo(() => {
        const sorted = [...modelShareItems].sort((a, b) => b.total_tokens - a.total_tokens);
        const total = summary?.total_tokens || 1;

        const mainList = sorted.slice(0, 4).map((m, idx) => ({
            name: m.model,
            tokens: m.total_tokens,
            requests: m.request_count,
            pct: Math.max(1, Math.round((m.total_tokens / total) * 100)),
            color: MODEL_NEON_COLORS[idx % MODEL_NEON_COLORS.length],
            modelIdx: idx,
        }));

        const otherTokens = sorted.slice(4).reduce((acc, m) => acc + m.total_tokens, 0);
        const otherReqs = sorted.slice(4).reduce((acc, m) => acc + m.request_count, 0);
        if (otherTokens > 0) {
            mainList.push({
                name: t('token_stats.other_models', '其他模型汇总'),
                tokens: otherTokens,
                requests: otherReqs,
                pct: Math.max(1, Math.round((otherTokens / total) * 100)),
                color: '#64748b',
                modelIdx: 4,
            });
        }

        const TOTAL_SPOKES = 36;
        const needles: { angle: number; length: number; color: string; modelName: string; modelIdx: number }[] = [];

        mainList.forEach((m) => {
            const spokeCount = Math.max(2, Math.round((m.pct / 100) * TOTAL_SPOKES));
            for (let i = 0; i < spokeCount; i++) {
                if (needles.length >= TOTAL_SPOKES) break;
                const spokeIdx = needles.length;
                const angle = (spokeIdx / TOTAL_SPOKES) * 2 * Math.PI - Math.PI / 2;
                const length = 18 + Math.round((m.pct / 100) * 16) + (spokeIdx % 2 === 0 ? 3 : 0);
                needles.push({
                    angle,
                    length,
                    color: m.color,
                    modelName: m.name,
                    modelIdx: m.modelIdx,
                });
            }
        });

        while (needles.length < TOTAL_SPOKES) {
            const spokeIdx = needles.length;
            const angle = (spokeIdx / TOTAL_SPOKES) * 2 * Math.PI - Math.PI / 2;
            needles.push({
                angle,
                length: 16,
                color: '#94a3b8',
                modelName: '空闲配额',
                modelIdx: -1,
            });
        }

        return {
            topModels: mainList,
            radialNeedles: needles,
        };
    }, [modelShareItems, summary, t]);

    const focusedModel = selectedModelIdx !== null ? topModels[selectedModelIdx] : null;

    // 4. 24 小时紧凑时段律动波形计算
    const { hourBuckets, maxHourTokens, peakHourLabel, troughHourLabel }: {
        hourBuckets: { hourLabel: string; full: string; data: HourlyUsagePoint; pct: number }[];
        maxHourTokens: number;
        peakHourLabel: string;
        troughHourLabel: string;
    } = useMemo(() => {
        const map = new Map<string, HourlyUsagePoint>();
        for (const h of hourlyData) {
            map.set(h.hour, h);
        }

        const now = new Date();
        const buckets: { hourLabel: string; full: string; data: HourlyUsagePoint; pct: number }[] = [];
        let peak = 0;
        let peakHour = '--:--';
        let minTokens = Infinity;
        let troughLabel = '--:--';

        for (let i = 23; i >= 0; i--) {
            const target = new Date(now.getTime() - i * 3600 * 1000);
            const yyyy = target.getFullYear();
            const mm = String(target.getMonth() + 1).padStart(2, '0');
            const dd = String(target.getDate()).padStart(2, '0');
            const hh = String(target.getHours()).padStart(2, '0');
            const key = `${yyyy}-${mm}-${dd} ${hh}:00`;
            const point = map.get(key) || {
                hour: key,
                total_tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                cached_tokens: 0,
                request_count: 0,
            };
            if (point.total_tokens > peak) {
                peak = point.total_tokens;
                peakHour = `${hh}:00`;
            }
            if (point.total_tokens < minTokens) {
                minTokens = point.total_tokens;
                troughLabel = `${hh}:00`;
            }
            buckets.push({
                hourLabel: `${hh}:00`,
                full: key,
                data: point,
                pct: 0,
            });
        }

        const effectivePeak = peak > 0 ? peak : 1;
        buckets.forEach(b => {
            // 真实数据驱动：0 使用时绝对为 0，彻底消除假矮柱；只有真实产生用量时才计算高度百分比
            b.pct = b.data.total_tokens > 0 && peak > 0
                ? Math.max(6, Math.round((b.data.total_tokens / effectivePeak) * 100))
                : 0;
        });

        return {
            hourBuckets: buckets,
            maxHourTokens: peak,
            peakHourLabel: peak > 0 ? peakHour : `${now.getHours()}:00`,
            troughHourLabel: troughLabel !== '--:--' ? troughLabel : '04:00',
        };
    }, [hourlyData]);

    const activeHour = hoveredHourIdx !== null ? hourBuckets[hoveredHourIdx] : null;

    // 5. 账号风险监控池
    const accountRiskPool = useMemo(() => {
        const sorted = [...accountData].sort((a, b) => b.total_tokens - a.total_tokens);
        const maxTokens = sorted[0]?.total_tokens || 1;
        const totalTokens = summary?.total_tokens || 1;

        return sorted.map((acc, idx) => {
            const sharePct = Math.round((acc.total_tokens / totalTokens) * 100);
            const relativePct = Math.min(100, Math.round((acc.total_tokens / maxTokens) * 100));
            const isHighConcentration = sharePct >= 45 && sorted.length > 1;

            return {
                rank: idx + 1,
                email: acc.account_email,
                name: acc.account_email.split('@')[0],
                tokens: acc.total_tokens,
                requests: acc.request_count,
                sharePct,
                relativePct,
                isHighConcentration,
                isPrimary: idx === 0,
                approxCost: (acc.total_tokens * 2.0) / 1000000,
            };
        });
    }, [accountData, summary]);

    // 6. 完整模型消耗排行榜
    const allModelsRankList = useMemo(() => {
        const sorted = [...modelShareItems].sort((a, b) => b.total_tokens - a.total_tokens);
        const maxTokens = sorted[0]?.total_tokens || 1;
        const totalTokens = summary?.total_tokens || 1;

        return sorted.map((m, idx) => {
            const sharePct = Math.round((m.total_tokens / totalTokens) * 100);
            const relativePct = Math.min(100, Math.round((m.total_tokens / maxTokens) * 100));

            return {
                rank: idx + 1,
                name: m.model,
                tokens: m.total_tokens,
                requests: m.request_count,
                sharePct,
                relativePct,
                color: MODEL_NEON_COLORS[idx % MODEL_NEON_COLORS.length],
                approxCost: (m.total_tokens * 2.5) / 1000000,
            };
        });
    }, [modelShareItems, summary]);

    // 7. 用户 Token 消耗排行榜
    const userTokensRankList = useMemo(() => {
        const sorted = [...userTokensRank].sort((a, b) => b.total_tokens - a.total_tokens);
        const maxTokens = sorted[0]?.total_tokens || 1;
        const totalTokens = summary?.total_tokens || 1;

        return sorted.map((u, idx) => {
            const sharePct = totalTokens > 0
                ? Math.round((u.total_tokens / totalTokens) * 100)
                : 0;
            const relativePct = maxTokens > 0
                ? Math.min(100, Math.round((u.total_tokens / maxTokens) * 100))
                : 0;

            return {
                ...u,
                rank: idx + 1,
                sharePct,
                relativePct,
            };
        });
    }, [userTokensRank, summary]);

    return (
        <div className="h-full w-full flex flex-col gap-3 font-sans select-none overflow-hidden text-gray-800 dark:text-gray-100">
            {/* ================= 7 : 3 主体分栏 (绝对零滚动容器) ================= */}
            <div className="flex-1 min-h-0 grid grid-cols-10 gap-3">
                {/* ---------------- 左侧 70%：宏观全景 + 时序与缓存效能 ---------------- */}
                <div className="col-span-7 flex flex-col gap-3 min-h-0">
                    {/* Card 1: 【超级核心大盘】用量调度全景 */}
                    <div className="flex-[54] min-h-[220px] bg-white/95 dark:bg-[#0c121e] border border-gray-200/90 dark:border-[#1e2a3f] rounded-2xl p-4 shadow-sm dark:shadow-xl relative overflow-hidden flex flex-col justify-between transition-colors">
                        {/* 顶栏小标题与操作 */}
                        <div className="shrink-0 flex items-center justify-between pb-2 mb-1 border-b border-gray-100 dark:border-white/[0.06]">
                            <span className="text-xs font-mono font-bold tracking-wider text-gray-700 dark:text-gray-200 uppercase">
                                {t('token_stats.cockpit_dispatch_report', '用量调度全景 DISPATCH REPORT')}
                            </span>
                            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-gray-500 dark:text-gray-400">
                                {/* 实时测速控制小胶囊 (按使用量排序主力模型) */}
                                <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-white/[0.05] pl-2 pr-1.5 py-0.5 rounded-lg border border-gray-200/70 dark:border-white/[0.08] text-[11px] font-mono">
                                    <span className="text-[10px] text-gray-400 font-sans">🎯 主力:</span>
                                    <span className="text-indigo-600 dark:text-cyan-300 font-bold max-w-[150px] truncate" title={targetModel}>
                                        {targetModel}
                                    </span>
                                    {modelShareItems && modelShareItems.length > 1 && (
                                        <select
                                            value={targetModel}
                                            onChange={(e) => {
                                                setTargetModel(e.target.value);
                                                handleRunProbe(e.target.value);
                                            }}
                                            className="bg-transparent text-[10px] text-gray-400 hover:text-gray-800 dark:hover:text-white outline-none cursor-pointer"
                                            title="按真实使用量切换模型"
                                        >
                                            {modelShareItems.map((m, idx) => (
                                                <option key={m.model} value={m.model} className="dark:bg-[#0c121e]">
                                                    {idx === 0 ? `★ ${m.model} (用量第一)` : m.model}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleRunProbe()}
                                        disabled={isProbing}
                                        className={`text-indigo-600 dark:text-cyan-400 hover:text-indigo-700 dark:hover:text-white p-0.5 transition-all cursor-pointer ${
                                            isProbing ? 'animate-spin opacity-70' : 'active:scale-95'
                                        }`}
                                        title="点击对主力模型执行即时链路测速"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                    </button>
                                </div>

                                <span>
                                    {t('token_stats.cockpit_period_label', '周期')}:{' '}
                                    <strong className="text-gray-900 dark:text-white">
                                        {timeRange === 'minute'
                                            ? t('token_stats.minute', '分钟')
                                            : timeRange === 'hourly'
                                            ? t('token_stats.hourly', '小时')
                                            : timeRange === 'daily'
                                            ? t('token_stats.daily', '日')
                                            : timeRange === 'weekly'
                                            ? t('token_stats.weekly', '周')
                                            : t('token_stats.all_time', '全部历史')}
                                    </strong>
                                </span>
                                {selectedModelIdx !== null && (
                                    <button
                                        onClick={() => setSelectedModelIdx(null)}
                                        className="text-[10px] text-blue-600 dark:text-emerald-400 hover:underline"
                                    >
                                        {t('token_stats.cockpit_reset_focus', '[重置聚焦]')}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 三栏并排核心：左用量/模型列表 + 中360°辐射彩针 + 右财务与均次指标 */}
                        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 items-center">
                            {/* [左 5 列]: 总消耗量大字号 + 核心模型列表 (支持 tooltip 完整名称展示) */}
                            <div className="col-span-5 flex flex-col justify-between space-y-2">
                                <div>
                                    <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 font-semibold uppercase">
                                        {t('token_stats.total_usage', '总消耗量')}
                                    </span>
                                    <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-gray-900 dark:text-white leading-none mt-1 flex items-baseline gap-1.5">
                                        <span>{formatNumber(summary?.total_tokens || 0)}</span>
                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Tokens</span>
                                    </div>
                                    <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400 mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                                        <span>
                                            {t('token_stats.input_short', '入')}:{' '}
                                            <strong className="text-gray-800 dark:text-white font-mono">{formatNumber(summary?.total_input_tokens || 0)}</strong> ({inOutRatio.inPct}%)
                                        </span>
                                        <span>/</span>
                                        <span>
                                            {t('token_stats.output_short', '出')}:{' '}
                                            <strong className="text-purple-600 dark:text-purple-300 font-mono">{formatNumber(summary?.total_output_tokens || 0)}</strong> ({inOutRatio.outPct}%)
                                        </span>
                                        <span
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                                deepMetrics.totalReasoning > 0
                                                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-500/20'
                                                    : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400'
                                            }`}
                                            title={`${t('token_stats.cockpit_thinking_share', '思考占比')}: ${deepMetrics.reasoningPctOfOutput}% (${formatNumber(deepMetrics.totalReasoning)} Tokens)`}
                                        >
                                            {t('token_stats.reasoning_short', '思')}: {formatNumber(deepMetrics.totalReasoning)} ({deepMetrics.reasoningPctOfOutput}%)
                                        </span>
                                    </div>
                                </div>

                                {/* 核心模型列表 */}
                                <div className="space-y-1 pt-1.5 border-t border-gray-100 dark:border-white/[0.06]">
                                    {topModels.map((m, idx) => {
                                        const isSelected = selectedModelIdx === idx;
                                        return (
                                            <div
                                                key={m.name}
                                                onClick={() => {
                                                    setSelectedModelIdx(isSelected ? null : idx);
                                                    setTargetModel(m.name);
                                                }}
                                                className={`group flex items-center justify-between text-xs font-mono px-2 py-0.5 rounded transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-blue-50 dark:bg-white/[0.12] ring-1 ring-blue-500/30 dark:ring-white/20'
                                                        : 'hover:bg-gray-100 dark:hover:bg-white/[0.05]'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2" title={m.name}>
                                                    <span
                                                        className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                                                        style={{ backgroundColor: m.color }}
                                                    />
                                                    <span className="text-gray-700 dark:text-gray-300 truncate text-[11px] font-medium">
                                                        {m.name}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTargetModel(m.name);
                                                            handleRunProbe(m.name);
                                                        }}
                                                        disabled={isProbing}
                                                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-white/[0.1] text-indigo-600 dark:text-cyan-400 transition-opacity"
                                                        title={`测速 ${m.name}`}
                                                    >
                                                        <Zap className="w-2.5 h-2.5" />
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-gray-500 dark:text-gray-400 text-[10px] font-mono">{formatNumber(m.tokens)}</span>
                                                    <span className="text-gray-900 dark:text-white font-bold text-[11px] font-mono">{m.pct}%</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* [中 4 列]: 360° 辐射彩针发光仪 */}
                            <div className="col-span-4 flex flex-col items-center justify-center relative">
                                <div className="relative w-[150px] h-[150px] flex items-center justify-center">
                                    <svg width="150" height="150" viewBox="0 0 150 150" className="overflow-visible animate-[spin_60s_linear_infinite]">
                                        <defs>
                                            <filter id="glowNeedle" x="-20%" y="-20%" width="140%" height="140%">
                                                <feGaussianBlur stdDeviation="1.5" result="blur" />
                                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                            </filter>
                                        </defs>

                                        {radialNeedles.map((n, i) => {
                                            const cx = 75;
                                            const cy = 75;
                                            const rInner = 36;
                                            const rOuter = rInner + n.length;
                                            const x1 = cx + rInner * Math.cos(n.angle);
                                            const y1 = cy + rInner * Math.sin(n.angle);
                                            const x2 = cx + rOuter * Math.cos(n.angle);
                                            const y2 = cy + rOuter * Math.sin(n.angle);

                                            const isSpokeFocused = selectedModelIdx === null || n.modelIdx === selectedModelIdx;

                                            return (
                                                <line
                                                    key={i}
                                                    x1={x1}
                                                    y1={y1}
                                                    x2={x2}
                                                    y2={y2}
                                                    stroke={n.color}
                                                    strokeWidth={i % 2 === 0 ? '2' : '1.2'}
                                                    strokeLinecap="round"
                                                    opacity={isSpokeFocused ? (i % 2 === 0 ? 0.95 : 0.7) : 0.15}
                                                    filter={isSpokeFocused ? 'url(#glowNeedle)' : undefined}
                                                />
                                            );
                                        })}

                                        <circle
                                            cx="75"
                                            cy="75"
                                            r="33"
                                            className="fill-gray-50 dark:fill-[#080d16] stroke-gray-200 dark:stroke-[#1f2d45]"
                                            strokeWidth="1.5"
                                        />
                                    </svg>

                                    {/* 环心微缩总览 */}
                                    <div className="absolute flex flex-col items-center pointer-events-none text-center px-1">
                                        <span className="text-sm font-extrabold font-mono text-gray-900 dark:text-white leading-none">
                                            {focusedModel ? formatNumber(focusedModel.tokens) : formatNumber(summary?.total_tokens || 0)}
                                        </span>
                                        <span className="text-[9px] font-mono text-gray-500 dark:text-gray-400 uppercase tracking-widest mt-0.5 truncate max-w-[68px]">
                                            {focusedModel ? `${focusedModel.pct}% ${t('token_stats.percentage', '占比')}` : 'SUMMARY'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* [右 3 列]: 预估总支出 + 均次成本 + 缓存抵扣 + 状态 */}
                            <div className="col-span-3 flex flex-col justify-between space-y-2 pl-3 border-l border-gray-100 dark:border-white/[0.06]">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-mono uppercase text-gray-500 dark:text-gray-400">
                                            {t('token_stats.cockpit_predicted_spend', '预估支出')}
                                        </span>
                                        <button
                                            onClick={() => setShowPricingModal(true)}
                                            className="text-[10px] text-blue-600 dark:text-emerald-400 hover:underline font-mono flex items-center gap-0.5"
                                        >
                                            {t('token_stats.pricing_matrix', '定价矩阵')} <ArrowUpRight className="w-2.5 h-2.5" />
                                        </button>
                                    </div>
                                    <div className="text-2xl font-black font-mono text-blue-600 dark:text-emerald-400 leading-none mt-1">
                                        ${totalEstimatedCost.toFixed(2)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                                        {t('token_stats.cockpit_avg_per_req', '均次')} ~${deepMetrics.avgCostPerReq < 0.01 ? deepMetrics.avgCostPerReq.toFixed(4) : deepMetrics.avgCostPerReq.toFixed(3)} / req
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[11px] font-mono uppercase text-gray-500 dark:text-gray-400">
                                        {t('token_stats.cockpit_cache_saved', '缓存节省')}
                                    </div>
                                    <div className="text-xl font-bold font-mono text-teal-600 dark:text-cyan-400 leading-none mt-0.5">
                                        +${cacheMetrics.savings.toFixed(2)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                                        {t('token_stats.cockpit_hit_rate_badge', {
                                            rate: cacheMetrics.hitRate.toFixed(1),
                                            defaultValue: `${cacheMetrics.hitRate.toFixed(1)}% 命中`,
                                        })}
                                    </div>
                                </div>

                                <div className="pt-1 border-t border-gray-100 dark:border-white/[0.06] text-[10px] font-mono flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 truncate">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            isProbing ? 'bg-amber-400 animate-ping' :
                                            loadMetrics && !loadMetrics.is_idle ? 'bg-emerald-400' :
                                            loadMetrics?.is_idle ? 'bg-cyan-400' : 'bg-emerald-400'
                                        }`} />
                                        <span className="text-gray-600 dark:text-gray-300 truncate" title={loadMetrics?.slack_advice || '网关调用正常'}>
                                            {isProbing ? '正在测速...' :
                                             loadMetrics && !loadMetrics.is_idle ? `${formatDurationMs(loadMetrics.avg_ttft_ms || loadMetrics.ttft_ms)} · ${loadMetrics.slack_title}` :
                                             loadMetrics?.is_idle ? '近1分钟待机 · 通道就绪' :
                                             t('token_stats.cockpit_status_normal', '网关调用正常')}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleRunProbe()}
                                        disabled={isProbing}
                                        className="text-indigo-600 dark:text-cyan-400 hover:underline font-bold shrink-0 ml-1 cursor-pointer"
                                    >
                                        {loadMetrics && !loadMetrics.is_idle && loadMetrics.tps > 0 ? `${loadMetrics.tps} t/s` : '测速'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Card 2: 【下半部分双翼卡片】 */}
                    <div className="flex-[46] min-h-[170px] grid grid-cols-2 gap-3">
                        {/* 2.1 左翼：24h 时段律动波形 */}
                        <div className="bg-white/95 dark:bg-[#0c121e] border border-gray-200/90 dark:border-[#1e2a3f] rounded-2xl p-3.5 flex flex-col justify-between shadow-sm dark:shadow-lg relative overflow-hidden transition-colors">
                            <div className="shrink-0 flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-white/[0.06]">
                                <span className="font-mono text-gray-700 dark:text-gray-300 font-bold flex items-center gap-1.5 text-xs">
                                    <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-emerald-400" />
                                    {t('token_stats.cockpit_activity_pulse', '24小时活跃律动')}
                                </span>
                                <div className="flex items-center gap-2 font-mono text-[11px]">
                                    <span className="text-gray-500 dark:text-gray-400">
                                        {t('token_stats.cockpit_avg_load', '均次')}: <strong className="text-gray-900 dark:text-white font-mono">{formatNumber(deepMetrics.avgTokensPerReq)}</strong>
                                    </span>
                                    <span className="text-gray-300 dark:text-white/[0.2]">|</span>
                                    <span className="text-blue-600 dark:text-emerald-400 font-bold font-mono">
                                        {t('token_stats.cockpit_peak', '峰值')}: {peakHourLabel}
                                    </span>
                                </div>
                            </div>

                            {/* 24 根音频频谱动态律动立柱 (0 使用无假柱，有使用随律动起伏) */}
                            <div className="flex-1 flex items-end justify-between gap-1 py-1 px-0.5">
                                {hourBuckets.map((bucket, i) => {
                                    const isPeak = bucket.data.total_tokens === maxHourTokens && maxHourTokens > 0;
                                    const isHovered = hoveredHourIdx === i;
                                    const hasData = bucket.data.total_tokens > 0;

                                    return (
                                        <div
                                            key={i}
                                            onMouseEnter={() => setHoveredHourIdx(i)}
                                            onMouseLeave={() => setHoveredHourIdx(null)}
                                            className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group relative"
                                        >
                                            {/* 顶部脉冲光珠 (仅在有真实使用量时显示，峰值带高光) */}
                                            {hasData ? (
                                                <div
                                                    className={`w-1 h-1 rounded-full mb-0.5 transition-all ${
                                                        isPeak
                                                            ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b] scale-125'
                                                            : isHovered
                                                            ? 'bg-white shadow-[0_0_6px_#ffffff]'
                                                            : 'bg-emerald-400/80 dark:bg-emerald-400'
                                                    }`}
                                                />
                                            ) : (
                                                <div className="w-0.5 h-0.5 rounded-full bg-gray-200 dark:bg-white/[0.08] mb-0.5" />
                                            )}

                                            {/* 柱体 (真实数据驱动：0 使用时绝对平整无柱，有使用时动态起伏) */}
                                            {hasData ? (
                                                <motion.div
                                                    initial={{ height: 0 }}
                                                    animate={{ height: `${bucket.pct}%` }}
                                                    transition={{
                                                        duration: 0.5,
                                                        delay: i * 0.015,
                                                        ease: [0.16, 1, 0.3, 1],
                                                    }}
                                                    className={`w-full rounded-t-sm transition-colors ${
                                                        isPeak
                                                            ? 'bg-gradient-to-t from-emerald-600 via-amber-400 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                                                            : isHovered
                                                            ? 'bg-gradient-to-t from-teal-500 to-cyan-300'
                                                            : 'bg-gradient-to-t from-blue-500/20 dark:from-[#0d2838] to-teal-500/80 dark:to-emerald-500/90'
                                                    }`}
                                                />
                                            ) : (
                                                <div className="w-full h-[1px] bg-gray-200 dark:bg-white/[0.06]" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="shrink-0 pt-1.5 border-t border-gray-100 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1.5">
                                    <Scale className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                    <span>{t('token_stats.cockpit_in_out_ratio', '入出倍率')}: <strong className="text-purple-600 dark:text-purple-300 font-mono">{inOutRatio.inOutMultiplier} : 1</strong></span>
                                </span>
                                <span>
                                    {activeHour ? (
                                        <span className="text-blue-600 dark:text-emerald-400 font-bold font-mono">
                                            {activeHour.hourLabel} · {formatNumber(activeHour.data.total_tokens)} tok
                                        </span>
                                    ) : (
                                        <span>{t('token_stats.cockpit_trough', '低谷')}: <strong className="text-gray-700 dark:text-gray-300 font-mono">{troughHourLabel}</strong></span>
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* 2.2 右翼：动感跑车码表 J23 效能与速度仪表盘 */}
                        <div
                            onClick={() => handleRunProbe()}
                            className="group bg-white/95 dark:bg-[#0c121e] border border-gray-200/90 dark:border-[#1e2a3f] hover:border-indigo-500/40 dark:hover:border-cyan-500/40 rounded-2xl p-3.5 flex flex-col justify-between shadow-sm dark:shadow-lg relative overflow-hidden transition-all cursor-pointer"
                            title="点击码表立刻向当前模型点火测速，指针动态摆动！"
                        >
                            <div className="shrink-0 flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-white/[0.06]">
                                <span className="font-mono text-gray-700 dark:text-gray-300 font-bold flex items-center gap-1.5 text-xs">
                                    <Flame className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 group-hover:animate-bounce" />
                                    {t('token_stats.cockpit_efficiency_index', '效能指数')} · J23
                                </span>
                                <div className="flex items-center gap-2">
                                    {deepMetrics.totalReasoning > 0 && (
                                        <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.2 rounded font-semibold" title={t('token_stats.cockpit_avg_thinking_per_req', '均次思考')}>
                                            ~{formatNumber(deepMetrics.avgReasoningPerReq)} {t('token_stats.reasoning_short', '思')} / req
                                        </span>
                                    )}
                                    <span className="font-mono text-[11px] text-teal-600 dark:text-teal-400 font-semibold flex items-center gap-1">
                                        <Zap className={`w-3 h-3 ${isProbing ? 'animate-spin text-amber-400' : ''}`} />
                                        {isProbing ? '测速中...' :
                                         loadMetrics && !loadMetrics.is_idle ? `${formatDurationMs(loadMetrics.avg_ttft_ms || loadMetrics.ttft_ms)} · ${loadMetrics.tps} t/s` :
                                         loadMetrics?.is_idle ? '待机就绪' :
                                         t('token_stats.zero_latency', '0 延时吞吐')}
                                    </span>
                                </div>
                            </div>

                            {/* 纯正超跑发光车速表盘 (半圆宽轨 + 刻度 + 发光能量条 + 完整轴承贯穿机械指针) */}
                            <div className="flex-1 relative flex items-center justify-center overflow-hidden py-1">
                                <svg width="220" height="106" viewBox="0 0 220 106" className="overflow-visible">
                                    <defs>
                                        <linearGradient id="speedoRainbowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#06b6d4" />
                                            <stop offset="35%" stopColor="#10b981" />
                                            <stop offset="70%" stopColor="#f59e0b" />
                                            <stop offset="100%" stopColor="#f43f5e" />
                                        </linearGradient>
                                        <linearGradient id="needleGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                                            <stop offset="0%" stopColor="#e11d48" />
                                            <stop offset="75%" stopColor="#fb7185" />
                                            <stop offset="100%" stopColor="#ffffff" />
                                        </linearGradient>
                                        <filter id="glowNeedle" x="-30%" y="-30%" width="160%" height="160%">
                                            <feGaussianBlur stdDeviation="2" result="blur" />
                                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                        </filter>
                                    </defs>

                                    {/* 1. 表盘外围深色底轨 (Track Arc) */}
                                    <path
                                        d="M 38 92 A 72 72 0 0 1 182 92"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="7"
                                        strokeLinecap="round"
                                        className="text-gray-150 dark:text-[#141d2e]"
                                    />

                                    {/* 2. 动态发光速度能量条 (平滑随命中率/速度填充，带霓虹光效) */}
                                    <motion.path
                                        d="M 38 92 A 72 72 0 0 1 182 92"
                                        fill="none"
                                        stroke="url(#speedoRainbowGrad)"
                                        strokeWidth="7"
                                        strokeLinecap="round"
                                        strokeDasharray="226.2"
                                        initial={{ strokeDashoffset: 226.2 }}
                                        animate={{
                                            strokeDashoffset: 226.2 * (1 - Math.min(100, Math.max(0, animatedRate)) / 100),
                                        }}
                                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                                        filter="url(#glowNeedle)"
                                    />

                                    {/* 3. 精密仪表刻度标记 (0 ~ 100 每 10% 一根刻度) */}
                                    {Array.from({ length: 21 }).map((_, i) => {
                                        const angle = Math.PI + (i / 20) * Math.PI;
                                        const cx = 110;
                                        const cy = 92;
                                        const isMajor = i % 5 === 0;
                                        const rInner = isMajor ? 56 : 60;
                                        const rOuter = 65;
                                        const x1 = cx + rInner * Math.cos(angle);
                                        const y1 = cy + rInner * Math.sin(angle);
                                        const x2 = cx + rOuter * Math.cos(angle);
                                        const y2 = cy + rOuter * Math.sin(angle);
                                        const isLit = (i / 20) * 100 <= cacheMetrics.hitRate;

                                        return (
                                            <line
                                                key={i}
                                                x1={x1}
                                                y1={y1}
                                                x2={x2}
                                                y2={y2}
                                                stroke={isLit ? '#ffffff' : 'currentColor'}
                                                className={isLit ? 'opacity-90' : 'text-gray-300 dark:text-[#22314a]'}
                                                strokeWidth={isMajor ? '1.8' : '1'}
                                                strokeLinecap="round"
                                            />
                                        );
                                    })}

                                    {/* 4. 车速表刻度数字 (0, 50, 100) */}
                                    <text x="32" y="103" textAnchor="middle" className="text-[9px] font-mono font-bold fill-gray-400 dark:fill-zinc-500">0</text>
                                    <text x="110" y="24" textAnchor="middle" className="text-[9px] font-mono font-bold fill-gray-400 dark:fill-zinc-500">50</text>
                                    <text x="188" y="103" textAnchor="middle" className="text-[9px] font-mono font-bold fill-gray-400 dark:fill-zinc-500">100</text>

                                    {/* 5. 真实跑车机械运动指针 (三角函数绝对锚定圆心，针尾牢牢锁死在中心，针尖精准指向刻度) */}
                                    <g>
                                        {/* 指针发光阴影 */}
                                        <line
                                            x1="110"
                                            y1="92"
                                            x2={needleCoords.tipX}
                                            y2={needleCoords.tipY}
                                            stroke="#f43f5e"
                                            strokeWidth="3.5"
                                            strokeLinecap="round"
                                            opacity="0.4"
                                            filter="url(#speedoGlow)"
                                        />
                                        {/* 跑车锋利机械指针本体 (贯穿圆心，带配重尾翼) */}
                                        <polygon
                                            points={needleCoords.points}
                                            fill="url(#speedoNeedleGrad)"
                                        />
                                        {/* 白热针尖微亮珠 */}
                                        <circle cx={needleCoords.tipX} cy={needleCoords.tipY} r="1.6" fill="#ffffff" />
                                    </g>

                                    {/* 6. 高精度合金轮毂轴承盖 (Pivot Hub) - 牢牢包裹指针根部 */}
                                    <circle
                                        cx="110"
                                        cy="92"
                                        r="9"
                                        className="fill-gray-900 dark:fill-[#080d17] stroke-gray-300 dark:stroke-[#3b4c68]"
                                        strokeWidth="1.8"
                                    />
                                    <circle
                                        cx="110"
                                        cy="92"
                                        r="5.5"
                                        className="fill-gray-800 dark:fill-[#121a2d] stroke-gray-400 dark:stroke-[#4a5f82]"
                                        strokeWidth="1"
                                    />
                                    <circle
                                        cx="110"
                                        cy="92"
                                        r="3"
                                        className="fill-rose-500 shadow-sm"
                                    />
                                    <circle
                                        cx="110"
                                        cy="92"
                                        r="1.2"
                                        fill="#ffffff"
                                    />
                                </svg>

                                <div className="absolute bottom-1 flex flex-col items-center text-center pointer-events-none">
                                    <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                        {t('token_stats.cockpit_hit_rate', '命中率')}: <strong className="text-teal-600 dark:text-emerald-400 font-mono">{cacheMetrics.hitRate.toFixed(1)}%</strong>
                                    </span>
                                    <span className="text-xl font-black font-mono text-gray-900 dark:text-white leading-none mt-0.5">
                                        {formatNumber(summary?.total_cached_tokens || 0)}
                                    </span>
                                    <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-0.5">
                                        {t('token_stats.cockpit_cached_tokens', '复用 TOKEN 规模')}
                                    </span>
                                </div>
                            </div>

                            <div className="shrink-0 pt-1.5 border-t border-gray-100 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-gray-400">
                                <span>{t('token_stats.cockpit_uncached_input', '未缓存输入')}: <strong className="text-gray-800 dark:text-white font-mono">{formatNumber(deepMetrics.uncachedInput)}</strong></span>
                                <span className="text-teal-600 dark:text-emerald-400 font-bold font-mono">
                                    +${cacheMetrics.savings.toFixed(2)} {t('token_stats.cockpit_saved_badge', '节省')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ---------------- 右侧 30%：多视图自由切换（账号排查 / 模型排行 / 用户排行） ---------------- */}
                <div className="col-span-3 flex flex-col gap-2.5 min-h-0 bg-white/95 dark:bg-[#0c121e] border border-gray-200/90 dark:border-[#1e2a3f] rounded-2xl p-4 shadow-sm dark:shadow-lg transition-colors">
                    {/* Top: 多视图 Tab 切换器 (强制三等分单行、不折行) */}
                    <div className="shrink-0 flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-white/[0.06]">
                        <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-[#121929] border border-gray-200 dark:border-[#1f2b42] rounded-lg p-0.5 w-full">
                            <button
                                onClick={() => setRightTab('accounts')}
                                className={`py-1.5 px-2 text-center rounded-md text-xs font-mono font-medium transition-all min-w-0 truncate ${
                                    rightTab === 'accounts'
                                        ? 'bg-white dark:bg-[#1e2a40] text-blue-600 dark:text-emerald-400 font-bold shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                title={`${t('token_stats.cockpit_account_audit', '账号排查')} (${accountData.length})`}
                            >
                                {t('token_stats.cockpit_tab_accounts', '账号')}
                            </button>
                            <button
                                onClick={() => setRightTab('models')}
                                className={`py-1.5 px-2 text-center rounded-md text-xs font-mono font-medium transition-all min-w-0 truncate ${
                                    rightTab === 'models'
                                        ? 'bg-white dark:bg-[#1e2a40] text-blue-600 dark:text-blue-400 font-bold shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                title={`${t('token_stats.cockpit_model_rank', '模型排行')} (${modelShareItems.length})`}
                            >
                                {t('token_stats.cockpit_tab_models', '模型')}
                            </button>
                            <button
                                onClick={() => setRightTab('users')}
                                className={`py-1.5 px-2 text-center rounded-md text-xs font-mono font-medium transition-all min-w-0 truncate ${
                                    rightTab === 'users'
                                        ? 'bg-white dark:bg-[#1e2a40] text-purple-600 dark:text-purple-400 font-bold shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                title={`${t('token_stats.cockpit_user_rank', '用户排行')} (${userTokensRank.length})`}
                            >
                                {t('token_stats.cockpit_tab_users', '用户')}
                            </button>
                        </div>
                    </div>

                    {/* Middle: 完整的消耗列表 (三视图完全国际化 + 完整名 title tooltip) */}
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-[#1e293b]">
                        {rightTab === 'accounts' ? (
                            accountRiskPool.length === 0 ? (
                                <div className="text-center text-xs text-gray-400 py-12 font-mono">
                                    {t('token_stats.no_account_activity', '暂无账号调用')}
                                </div>
                            ) : (
                                accountRiskPool.map((acc) => (
                                    <div
                                        key={acc.email}
                                        className={`p-2.5 rounded-xl border transition-all ${
                                            acc.isHighConcentration
                                                ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                                                : 'bg-gray-50/80 dark:bg-[#111929] border-gray-200/70 dark:border-[#1b263b] hover:border-gray-300 dark:hover:border-[#2a3a59]'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between text-xs font-mono mb-1 gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                <span
                                                    className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold shrink-0 ${
                                                        acc.rank === 1
                                                            ? 'bg-amber-400 text-black'
                                                            : acc.rank === 2
                                                            ? 'bg-gray-300 text-black'
                                                            : acc.rank === 3
                                                            ? 'bg-amber-700 text-white'
                                                            : 'bg-gray-200 dark:bg-[#1f293d] text-gray-600 dark:text-gray-400'
                                                    }`}
                                                >
                                                    {acc.rank}
                                                </span>
                                                <span className="text-gray-800 dark:text-gray-200 font-semibold truncate" title={acc.email}>
                                                    {acc.name}
                                                </span>
                                                {acc.isPrimary && (
                                                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-400/20 text-amber-700 dark:text-amber-300 font-mono shrink-0">
                                                        {t('token_stats.cockpit_primary_badge', '主力')}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-blue-600 dark:text-emerald-400 font-bold font-mono shrink-0">
                                                {formatNumber(acc.tokens)}
                                            </span>
                                        </div>

                                        <div className="w-full h-1.5 bg-gray-200 dark:bg-[#172236] rounded-full overflow-hidden mb-1.5">
                                            <div
                                                className={`h-full ${
                                                    acc.isHighConcentration
                                                        ? 'bg-amber-500 dark:bg-amber-400'
                                                        : 'bg-gradient-to-r from-blue-500 dark:from-emerald-500 to-cyan-500 dark:to-teal-400'
                                                }`}
                                                style={{ width: `${acc.relativePct}%` }}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                            <span>{t('token_stats.percentage', '占比')}: {acc.sharePct}% ({acc.requests} {t('token_stats.times', '次')})</span>
                                            {acc.isHighConcentration ? (
                                                <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-0.5">
                                                    <AlertTriangle className="w-3 h-3" /> {t('token_stats.cockpit_high_concentration', '流量高度集中')}
                                                </span>
                                            ) : (
                                                <span>~${acc.approxCost.toFixed(2)}</span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )
                        ) : rightTab === 'models' ? (
                            allModelsRankList.length === 0 ? (
                                <div className="text-center text-xs text-gray-400 py-12 font-mono">
                                    {t('token_stats.no_model_activity', '暂无模型活动')}
                                </div>
                            ) : (
                                allModelsRankList.map((m) => (
                                    <div
                                        key={m.name}
                                        className="p-2.5 rounded-xl border bg-gray-50/80 dark:bg-[#111929] border-gray-200/70 dark:border-[#1b263b] hover:border-gray-300 dark:hover:border-[#2a3a59] transition-all"
                                    >
                                        <div className="flex items-center justify-between text-xs font-mono mb-1 gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                <span
                                                    className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold shrink-0 ${
                                                        m.rank === 1
                                                            ? 'bg-blue-500 text-white'
                                                            : m.rank === 2
                                                            ? 'bg-purple-500 text-white'
                                                            : m.rank === 3
                                                            ? 'bg-cyan-500 text-black'
                                                            : 'bg-gray-200 dark:bg-[#1f293d] text-gray-600 dark:text-gray-400'
                                                    }`}
                                                >
                                                    {m.rank}
                                                </span>
                                                <span className="text-gray-800 dark:text-gray-200 font-semibold truncate" title={m.name}>
                                                    {m.name}
                                                </span>
                                            </div>
                                            <span className="text-blue-600 dark:text-blue-400 font-bold font-mono shrink-0">
                                                {formatNumber(m.tokens)}
                                            </span>
                                        </div>

                                        <div className="w-full h-1.5 bg-gray-200 dark:bg-[#172236] rounded-full overflow-hidden mb-1.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500"
                                                style={{ width: `${m.relativePct}%` }}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                            <span>{t('token_stats.percentage', '占比')}: {m.sharePct}% ({m.requests} {t('token_stats.times', '次')})</span>
                                            <span>~${m.approxCost.toFixed(2)}</span>
                                        </div>
                                    </div>
                                ))
                            )
                        ) : (
                            userTokensLoading ? (
                                <div className="flex items-center justify-center py-12 text-xs text-gray-400 font-mono">
                                    <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
                                    {t('common.loading', '加载中...')}
                                </div>
                            ) : userTokensRankList.length === 0 ? (
                                <div className="text-center text-xs text-gray-400 py-12 font-mono">
                                    {t('token_stats.cockpit_no_user_activity', '暂无用户 Key 消耗活动')}
                                </div>
                            ) : (
                                userTokensRankList.map((u) => (
                                    <div
                                        key={u.id}
                                        onClick={() => {
                                            setSelectedUserToken({
                                                id: u.id,
                                                token: u.token,
                                                username: u.username,
                                                description: u.description || undefined,
                                                enabled: u.enabled,
                                                expires_type: u.expires_type,
                                                expires_at: u.expires_at || undefined,
                                                max_ips: u.max_ips,
                                                total_requests: u.requests,
                                                total_tokens_used: u.total_tokens,
                                            });
                                            setShowUserTokenModal(true);
                                        }}
                                        className="group p-2.5 rounded-xl border bg-gray-50/80 dark:bg-[#111929] border-gray-200/70 dark:border-[#1b263b] hover:border-purple-400 dark:hover:border-purple-500/50 hover:bg-white dark:hover:bg-[#152033] cursor-pointer transition-all shadow-none hover:shadow-sm"
                                    >
                                        <div className="flex items-center justify-between text-xs font-mono mb-1 gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                <span
                                                    className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold shrink-0 ${
                                                        u.rank === 1
                                                            ? 'bg-amber-400 text-black'
                                                            : u.rank === 2
                                                            ? 'bg-gray-300 text-black dark:bg-gray-400'
                                                            : u.rank === 3
                                                            ? 'bg-amber-700 text-white'
                                                            : 'bg-gray-200 dark:bg-[#1f293d] text-gray-600 dark:text-gray-400'
                                                    }`}
                                                >
                                                    {u.rank}
                                                </span>
                                                <span className="text-gray-800 dark:text-gray-200 font-semibold truncate" title={u.username}>
                                                    {u.username}
                                                </span>
                                                <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 shrink-0 hidden sm:inline" title={u.token}>
                                                    {u.token ? `${u.token.slice(0, 4)}...${u.token.slice(-4)}` : ''}
                                                </span>
                                                {!u.enabled && (
                                                    <span className="text-[9px] px-1 py-0.2 rounded bg-red-100 dark:bg-red-400/20 text-red-600 dark:text-red-400 font-mono shrink-0">
                                                        {t('user_token.disabled', '已禁用')}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-purple-600 dark:text-purple-400 font-bold font-mono shrink-0">
                                                {formatNumber(u.total_tokens)}
                                            </span>
                                        </div>

                                        <div className="w-full h-1.5 bg-gray-200 dark:bg-[#172236] rounded-full overflow-hidden mb-1.5">
                                            <div
                                                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500"
                                                style={{ width: `${u.relativePct}%` }}
                                            />
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                            <span>
                                                {t('token_stats.percentage', '占比')}: {u.sharePct}% ({u.requests} {t('token_stats.times', '次')})
                                            </span>
                                            <span className="text-purple-600 dark:text-purple-400 group-hover:underline flex items-center gap-0.5">
                                                {t('token_stats.cockpit_view_detail', '详情')} <ArrowUpRight className="w-3 h-3" />
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )
                        )}
                    </div>

                    {/* 底部防御状态 */}
                    <div className="shrink-0 pt-2 border-t border-gray-100 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-gray-400">
                        <span>{t('token_stats.cockpit_waf_active', '网关防刷隔离')}</span>
                        <span className="text-blue-600 dark:text-emerald-400 font-bold">● {t('token_stats.cockpit_active_badge', '已激活')}</span>
                    </div>
                </div>
            </div>

            {/* 用户 Token 专属用量弹窗 */}
            <UserTokenStatsModal
                isOpen={showUserTokenModal}
                onClose={() => setShowUserTokenModal(false)}
                token={selectedUserToken}
            />
        </div>
    );
};
