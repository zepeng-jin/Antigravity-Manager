import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    Gauge,
    RefreshCw,
    Zap,
    Coffee,
    Laptop,
    Gamepad2,
} from 'lucide-react';
import { request as invoke } from '../../utils/request';

export interface SpeedProbeResult {
    model: string;
    display_name: string;
    account_email: string;
    success: boolean;
    status_code: number;
    ttft_ms: number;
    total_duration_ms: number;
    output_tokens: number;
    tps: number;
    slack_level: 'sprint' | 'smooth' | 'tea' | 'slack';
    slack_score: number;
    slack_title: string;
    slack_advice: string;
    error_msg?: string;
    timestamp: number;
}

export interface ProbeModelTarget {
    id: string;
    name: string;
    vendor: string;
}

const DEFAULT_TARGETS: ProbeModelTarget[] = [
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', vendor: 'Anthropic' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', vendor: 'Google' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', vendor: 'Google' },
];

const LOCAL_STORAGE_KEY = 'antigravity_last_speed_probe_result';

export function SpeedProbeCard() {
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.0-flash');
    const [loading, setLoading] = useState<boolean>(false);
    const [result, setResult] = useState<SpeedProbeResult | null>(() => {
        try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return null;
    });

    const handleProbe = useCallback(async (modelId?: string) => {
        const targetModel = modelId || selectedModel;
        setLoading(true);
        try {
            const probeRes = await invoke<SpeedProbeResult>('run_speed_probe', {
                model: targetModel,
                accountEmail: null,
            });
            setResult(probeRes);
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(probeRes));
            } catch (e) {}
        } catch (error: any) {
            console.error('[SpeedProbe] Failed:', error);
            // 构造错误保底展示
            const fallback: SpeedProbeResult = {
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
                error_msg: String(error),
                timestamp: Math.floor(Date.now() / 1000),
            };
            setResult(fallback);
        } finally {
            setLoading(false);
        }
    }, [selectedModel]);

    // 初次加载如果无历史测速结果，自动轻量测速一次
    useEffect(() => {
        if (!result) {
            handleProbe('gemini-2.0-flash');
        }
    }, []);

    const getSlackTheme = (level?: string) => {
        switch (level) {
            case 'sprint':
                return {
                    badgeBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                    progressColor: 'from-emerald-500 to-teal-400',
                    icon: Zap,
                    meterText: 'text-emerald-600 dark:text-emerald-400',
                    ringBg: 'border-emerald-500',
                };
            case 'smooth':
                return {
                    badgeBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
                    progressColor: 'from-blue-500 to-indigo-400',
                    icon: Laptop,
                    meterText: 'text-blue-600 dark:text-blue-400',
                    ringBg: 'border-blue-500',
                };
            case 'tea':
                return {
                    badgeBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
                    progressColor: 'from-amber-500 to-orange-400',
                    icon: Coffee,
                    meterText: 'text-amber-600 dark:text-amber-400',
                    ringBg: 'border-amber-500',
                };
            case 'slack':
            default:
                return {
                    badgeBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20',
                    progressColor: 'from-rose-500 to-red-400',
                    icon: Gamepad2,
                    meterText: 'text-rose-600 dark:text-rose-400',
                    ringBg: 'border-rose-500',
                };
        }
    };

    const theme = getSlackTheme(result?.slack_level);
    const StatusIcon = theme.icon;

    const timeAgo = (ts?: number) => {
        if (!ts) return '未测速';
        const diff = Math.floor(Date.now() / 1000) - ts;
        if (diff < 15) return '刚刚';
        if (diff < 60) return `${diff} 秒前`;
        if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
        return `${Math.floor(diff / 3600)} 小时前`;
    };

    return (
        <motion.div
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
            className="bg-white dark:bg-[#15161b] rounded-2xl p-5 shadow-sm dark:shadow-xl dark:shadow-black/40 border border-gray-100 dark:border-white/[0.10] flex flex-col justify-between relative overflow-hidden"
        >
            {/* 背景动态氛围微光 */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-gradient-to-br from-indigo-500/10 to-purple-500/0 rounded-full blur-2xl pointer-events-none" />

            <div className="space-y-4">
                {/* 顶栏：标题 + 目标模型切换药丸 + 一键测速刷新 */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-transparent dark:border-indigo-500/20">
                            <Gauge className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="text-xs font-bold text-gray-800 dark:text-zinc-200">
                                实时服务速度探测 · 摸鱼雷达
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 ml-2 font-mono">
                                {timeAgo(result?.timestamp)}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* 常用模型药丸切换 */}
                        <div className="flex bg-gray-100 dark:bg-white/[0.04] p-0.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] text-[11px]">
                            {DEFAULT_TARGETS.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedModel(t.id);
                                        handleProbe(t.id);
                                    }}
                                    disabled={loading}
                                    className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                                        selectedModel === t.id
                                            ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm font-bold dark:border dark:border-white/[0.12]'
                                            : 'text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
                                    }`}
                                >
                                    {t.name.replace('Gemini ', '').replace('Claude ', '')}
                                </button>
                            ))}
                        </div>

                        {/* 测速动作按钮 */}
                        <button
                            type="button"
                            onClick={() => handleProbe()}
                            disabled={loading}
                            className={`px-3 py-1 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/30 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer ${
                                loading ? 'opacity-70 cursor-not-allowed' : ''
                            }`}
                            title="探测上游延迟与输出速率"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            <span>{loading ? '测速中...' : '即刻测速'}</span>
                        </button>
                    </div>
                </div>

                {/* 核心中段：左右双核 Bento 布局 */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center">
                    {/* 左侧：工作 vs 摸鱼指数仪表盘 */}
                    <div className="md:col-span-7 bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-3.5 border border-gray-100 dark:border-white/[0.06] flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-bold text-gray-600 dark:text-zinc-300 flex items-center gap-1.5">
                                <StatusIcon className="w-3.5 h-3.5" />
                                <span>{result?.slack_title || '探测服务状态中...'}</span>
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${theme.badgeBg}`}>
                                摸鱼指数 {result?.slack_score ?? 0}%
                            </span>
                        </div>

                        {/* 摸鱼进度条 */}
                        <div className="w-full bg-gray-200 dark:bg-white/[0.08] h-2 rounded-full overflow-hidden mb-2.5">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${result?.slack_score ?? 0}%` }}
                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                className={`h-full bg-gradient-to-r ${theme.progressColor}`}
                            />
                        </div>

                        {/* 趣味指导文案 */}
                        <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed font-sans">
                            {result?.slack_advice || '点击上方按钮发起极轻量测速，立刻获得当下工作决策建议。'}
                        </p>
                    </div>

                    {/* 右侧：三大硬核测速指标数字流 */}
                    <div className="md:col-span-5 grid grid-cols-3 gap-2">
                        {/* 首字延迟 TTFT */}
                        <div className="bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-2.5 border border-gray-100 dark:border-white/[0.06] flex flex-col justify-between text-center">
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">首字延迟</span>
                            <div className="text-base sm:text-lg font-black font-mono tracking-tight text-gray-900 dark:text-white mt-0.5">
                                {loading ? '...' : (result?.success ? `${result.ttft_ms}ms` : '超时')}
                            </div>
                            <span className={`text-[9px] font-mono mt-0.5 ${
                                !result?.success ? 'text-rose-500' :
                                result.ttft_ms < 800 ? 'text-emerald-500 font-bold' :
                                result.ttft_ms < 1800 ? 'text-blue-500' :
                                result.ttft_ms < 3000 ? 'text-amber-500' : 'text-rose-500'
                            }`}>
                                {!result?.success ? '失败' : result.ttft_ms < 800 ? '极速' : result.ttft_ms < 1800 ? '流畅' : '排队'}
                            </span>
                        </div>

                        {/* 生成速率 TPS */}
                        <div className="bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-2.5 border border-gray-100 dark:border-white/[0.06] flex flex-col justify-between text-center">
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">吐字速率</span>
                            <div className="text-base sm:text-lg font-black font-mono tracking-tight text-gray-900 dark:text-white mt-0.5">
                                {loading ? '...' : (result?.success ? `${result.tps}` : '0')}
                            </div>
                            <span className="text-[9px] text-gray-400 dark:text-zinc-500 font-mono mt-0.5">
                                tok/s
                            </span>
                        </div>

                        {/* 状态码与耗时 */}
                        <div className="bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-2.5 border border-gray-100 dark:border-white/[0.06] flex flex-col justify-between text-center">
                            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">链路往返</span>
                            <div className="text-base sm:text-lg font-black font-mono tracking-tight text-gray-900 dark:text-white mt-0.5">
                                {loading ? '...' : (result?.success ? `${result.total_duration_ms}ms` : `${result?.status_code || 500}`)}
                            </div>
                            <span className={`text-[9px] font-mono mt-0.5 ${result?.success ? 'text-emerald-500' : 'text-rose-500 font-bold'}`}>
                                {result?.success ? 'HTTP 200' : '连接异常'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
