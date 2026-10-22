export interface RealtimeSpeedMetrics {
    model: string;
    display_name: string;
    account_email: string;
    success: boolean;
    status_code: number;
    ttft_ms: number;
    total_duration_ms: number;
    output_tokens: number;
    tps: number;
    slack_level: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle';
    slack_score: number;
    slack_title: string;
    slack_advice: string;
    is_live_log: boolean; // 标识是否来自真实日志实时推送
    timestamp: number;
}

/// 格式化人性化时间差 (秒级精确)
export function formatTimeAgo(ts?: number): string {
    if (!ts || ts <= 0) return '尚未测速';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - ts);
    if (diff < 10) return '刚刚';
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
}

/// 检查数据是否过期 (超过 20 分钟未更新视为待机)
export function isMetricsStale(ts?: number): boolean {
    if (!ts || ts <= 0) return true;
    const now = Math.floor(Date.now() / 1000);
    return (now - ts) > 1200; // 20 分钟
}

export function computeSlackStatus(
    durationMs: number,
    status: number,
    outputTokens: number = 0,
    modelName: string = 'gemini-3.8-flash-high',
    accountEmail: string = '',
    isLiveLog: boolean = false
): RealtimeSpeedMetrics {
    // 过滤假请求与本地回环瞬时心跳 (例如 < 30ms 的本地探测，防止产生 1ms 的极速误导)
    const validDuration = Math.max(50, durationMs);
    const success = status >= 200 && status < 400;
    const ttft_ms = validDuration;
    const total_duration_ms = validDuration;

    // 科学估算 TPS
    const gen_secs = (validDuration / 1000) || 0.1;
    const tps = outputTokens > 0
        ? Number(((outputTokens / gen_secs) * 10 / 10).toFixed(1))
        : Number(((1000 / validDuration) * 28).toFixed(1));

    let slack_level: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle' = 'smooth';
    let slack_score = 30;
    let slack_title = '💻 节奏平稳 · 专注干活 💼';
    let slack_advice = '服务延迟适中稳定，上游状态良好，一杯茶一包烟，一行代码写一天。';

    if (!success) {
        slack_level = 'slack';
        slack_score = 100;
        if (status === 429) {
            slack_title = '🚨 官方限流排队 · 奉旨摸鱼 🎮';
            slack_advice = '上游接口触发频率限制或配额排队，非本地故障，请理直气壮去摸鱼！';
        } else if (status >= 500) {
            slack_title = '⚠️ 官方服务波动 · 建议喝茶 🍵';
            slack_advice = '上游服务器暂时故障，服务不可用，建议去泡杯茶稍后再试。';
        } else {
            slack_title = '❌ 链路调用异常 · 建议检查网络 🌐';
            slack_advice = '请求未成功返回，请检查代理隧道或网络配置。';
        }
    } else if (ttft_ms < 650) {
        slack_level = 'sprint';
        slack_score = 5;
        slack_title = '⚡️ 极速狂飙 · 搬砖效率翻倍 🚀';
        slack_advice = '上游响应极其丝滑，毫秒级首字吐出，趁现在灵感爆发疯狂输出代码！';
    } else if (ttft_ms < 1400) {
        slack_level = 'smooth';
        slack_score = 30;
        slack_title = '💻 节奏平稳 · 专注干活 💼';
        slack_advice = '服务延迟适中稳定，上游状态良好，一杯茶一包烟，一行代码写一天。';
    } else if (ttft_ms < 2800) {
        slack_level = 'tea';
        slack_score = 70;
        slack_title = '☕️ 上游迟缓 · 适度摸鱼 🍵';
        slack_advice = '官方接口排队中，延迟明显偏高（>1.5s），建议起身走走、活动肩颈。';
    } else {
        slack_level = 'slack';
        slack_score = 95;
        slack_title = '🏖️ 深度拥堵 · 奉旨摸鱼 😴';
        slack_advice = '上游响应超过 2.8 秒，排队严重。系统批准摸鱼，去打把游戏吧！';
    }

    return {
        model: modelName,
        display_name: modelName,
        account_email: accountEmail,
        success,
        status_code: status,
        ttft_ms,
        total_duration_ms,
        output_tokens: outputTokens,
        tps: Math.min(120, Math.max(5, tps)),
        slack_level,
        slack_score,
        slack_title,
        slack_advice,
        is_live_log: isLiveLog,
        timestamp: Math.floor(Date.now() / 1000),
    };
}
