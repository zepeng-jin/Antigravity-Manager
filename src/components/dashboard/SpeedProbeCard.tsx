import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    RefreshCw,
} from 'lucide-react';
import { request as invoke } from '../../utils/request';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../../utils/env';
import {
    computeSlackStatus,
    formatTimeAgo,
    isMetricsStale,
    RealtimeSpeedMetrics,
} from '../../utils/speedProbeLogSync';
import { FishMoyuIcon } from './FishMoyuIcon';

export interface ProbeModelInfo {
    id: string;
    name: string;
    vendor: string;
    source: string;
}

const LOCAL_STORAGE_KEY = 'antigravity_last_speed_probe_result';

export function SpeedProbeCard() {
    const [dynamicTargets, setDynamicTargets] = useState<ProbeModelInfo[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('gemini-3.8-flash-high');
    const [loading, setLoading] = useState<boolean>(false);
    const [result, setResult] = useState<RealtimeSpeedMetrics | null>(() => {
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
                    // 默认锁定在真实使用量 No.1 的主力模型上
                    setSelectedModel(targets[0].id);
                }
            })
            .catch((e) => console.error('[SpeedProbe] Failed to fetch models:', e));
    }, []);

    const handleProbe = useCallback(async (modelId?: string) => {
        const targetModel = (modelId || selectedModel).trim();
        setLoading(true);
        try {
            const probeRes = await invoke<RealtimeSpeedMetrics>('run_speed_probe', {
                model: targetModel,
                accountEmail: null,
            });
            setResult(probeRes);
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(probeRes));
            } catch (e) {}
        } catch (error: any) {
            console.error('[SpeedProbe] Failed:', error);
            const fallback: RealtimeSpeedMetrics = {
                model: targetModel,
                display_name: targetModel,
                account_email: '',
                success: false,
                status_code: 500,
                ttft_ms: 9999,
                total_duration_ms: 9999,
                output_tokens: 0,
                tps: 0,
                slack_level: 'slack',
                slack_score: 100,
                slack_title: '🚨 探针异常 · 奉旨摸鱼 🎮',
                slack_advice: typeof error === 'string' ? error : '上游网络超时或无可用在线账号，理直气壮休息一下！',
                is_live_log: false,
                timestamp: Math.floor(Date.now() / 1000),
            };
            setResult(fallback);
        } finally {
            setLoading(false);
        }
    }, [selectedModel]);

    // 核心优化 1：初次载入时，优先从真实网关日志拉取最近 1 次业务请求的速度 (解决明明在使用却显示3小时前空闲的Bug)
    useEffect(() => {
        invoke<RealtimeSpeedMetrics | null>('get_latest_real_speed')
            .then((latest) => {
                if (latest) {
                    setResult(latest);
                    if (latest.model) {
                        setSelectedModel(latest.model);
                    }
                    try {
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(latest));
                    } catch (e) {}
                } else if (!result) {
                    handleProbe('gemini-3.8-flash-high');
                }
            })
            .catch(() => {
                if (!result) handleProbe('gemini-3.8-flash-high');
            });
    }, []);

    // 核心优化 2：持续监听真实代理请求日志，全自动实时零开销刷新速度与摸鱼指数
    useEffect(() => {
        if (!isTauri()) return;
        let unlistenFn: (() => void) | null = null;
        const setupLogListener = async () => {
            try {
                unlistenFn = await listen<any>('proxy://request', (event) => {
                    const log = event.payload;
                    // 过滤非业务假请求与极短本地回环 (< 40ms)
                    if (!log || typeof log.duration !== 'number' || log.duration < 40) return;
                    const reqModel = log.model || selectedModel;
                    const status = log.status || 200;
                    const outputTokens = log.output_tokens || 0;

                    // 自动同步当前主力模型为真实触发请求的模型
                    if (log.model) {
                        setSelectedModel(log.model);
                    }

                    const liveMetrics = computeSlackStatus(
                        log.duration,
                        status,
                        outputTokens,
                        reqModel,
                        log.account_email || '',
                        true
                    );
                    setResult(liveMetrics);
                    try {
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(liveMetrics));
                    } catch (e) {}
                });
            } catch (e) {
                console.debug('[SpeedProbe] Live log listener setup skipped:', e);
            }
        };

        setupLogListener();
        return () => {
            if (unlistenFn) unlistenFn();
        };
    }, [selectedModel]);

    // 判断时效性：若超过 20 分钟没有真实日志，自动显示为待机并提示更新时间
    const isStale = isMetricsStale(result?.timestamp);

    const getSlackTheme = (level?: string) => {
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

    const theme = getSlackTheme(result?.slack_level);

    return (
        <div className="bg-white/95 dark:bg-[#15161b] rounded-2xl px-4 py-2.5 shadow-sm dark:shadow-lg dark:shadow-black/30 border border-gray-150 dark:border-white/[0.08] relative overflow-hidden transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                {/* 左翼：摸鱼小鱼 + 状态标语 + 摸鱼指数 */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* 灵动摸鱼小鱼 (摇尾巴吐泡泡) */}
                    <FishMoyuIcon level={result?.slack_level} className="w-6 h-6 shrink-0" />

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900 dark:text-zinc-100 truncate">
                                {isStale ? '待机空闲 · 建议测速探活' : result?.slack_title || '探测服务状态中...'}
                            </span>
                            <span className={`text-[10px] px-2 py-0.2 rounded-full font-mono font-bold border shrink-0 ${theme.badgeBg}`}>
                                摸鱼指数 {isStale ? '—' : `${result?.slack_score ?? 0}%`}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-mono shrink-0">
                                {formatTimeAgo(result?.timestamp)}
                            </span>
                        </div>

                        {/* 趣味指导文案与极简微进度条 */}
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-24 sm:w-32 bg-gray-100 dark:bg-white/[0.08] h-1.5 rounded-full overflow-hidden shrink-0">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: isStale ? '0%' : `${result?.slack_score ?? 0}%` }}
                                    transition={{ duration: 0.5, ease: 'easeOut' }}
                                    className={`h-full bg-gradient-to-r ${theme.progressColor}`}
                                />
                            </div>
                            <span className="text-[11px] text-gray-500 dark:text-zinc-400 truncate font-sans">
                                {isStale ? '超过20分钟未产生新请求，点击即刻测速获取最新上游延迟。' : result?.slack_advice}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 右翼：三大数字指标 + 唯一主力模型胶囊 + 测速按钮 */}
                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                    {/* 三大极简紧凑数字指标 */}
                    <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-150 dark:border-white/[0.06] text-center font-mono">
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">首字</div>
                            <div className={`text-xs font-bold leading-tight mt-0.5 ${theme.textColor}`}>
                                {loading ? '...' : isStale ? '—' : result?.success ? `${result.ttft_ms}ms` : '失败'}
                            </div>
                        </div>
                        <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08]" />
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">速率</div>
                            <div className="text-xs font-bold leading-tight text-gray-800 dark:text-zinc-200 mt-0.5">
                                {loading ? '...' : isStale ? '—' : result?.success ? `${result.tps}` : '0'}
                            </div>
                        </div>
                        <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08]" />
                        <div>
                            <div className="text-[9px] text-gray-400 dark:text-zinc-500 leading-none">链路</div>
                            <div className="text-xs font-bold leading-tight text-gray-800 dark:text-zinc-200 mt-0.5">
                                {loading ? '...' : isStale ? '—' : result?.success ? `${result.total_duration_ms}ms` : '异常'}
                            </div>
                        </div>
                    </div>

                    {/* 纯正主力模型选择胶囊 (单一下拉控件，杜绝文字重复叠放) */}
                    <div className="flex items-center bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200/60 dark:hover:bg-white/[0.1] px-2 py-1 rounded-xl border border-gray-200/70 dark:border-white/[0.1] text-xs font-mono transition-all">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mr-1.5 shrink-0 animate-pulse" />
                        <select
                            value={selectedModel}
                            onChange={(e) => {
                                setSelectedModel(e.target.value);
                                handleProbe(e.target.value);
                            }}
                            className="bg-transparent text-xs font-bold text-gray-800 dark:text-cyan-300 outline-none cursor-pointer pr-1 max-w-[190px]"
                            title="按真实使用量切换探测模型"
                        >
                            {dynamicTargets.length > 0 ? (
                                dynamicTargets.slice(0, 8).map((t, idx) => (
                                    <option key={t.id} value={t.id} className="dark:bg-[#15161b] text-gray-900 dark:text-white font-normal">
                                        {idx === 0 ? `${t.id} (主力)` : t.id}
                                    </option>
                                ))
                            ) : (
                                <option value={selectedModel} className="dark:bg-[#15161b]">{selectedModel}</option>
                            )}
                        </select>
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
