export interface RealtimeSpeedMetrics {
    model: string;
    display_name: string;
    account_email: string;
    success: boolean;
    status_code: number;
    ttft_ms: number;
    total_duration_ms: number;
    output_tokens: number;
    input_tokens: number;
    tps: number;
    slack_level: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle';
    slack_score: number;
    slack_title: string;
    slack_advice: string;
    is_live_log: boolean; // 标识是否来自真实日志实时推送
    timestamp: number;
}

/// 格式化毫秒为人类可读格式 (>=1000ms 显示为秒，避免像 14678ms 这样挤爆排版)
export function formatDurationMs(ms?: number): string {
    if (!ms || ms <= 0) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
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
    inputTokens: number = 0,
    modelName: string = 'gemini-3.8-flash-high',
    accountEmail: string = '',
    isLiveLog: boolean = false
): RealtimeSpeedMetrics {
    const validDuration = Math.max(50, durationMs);
    const success = status >= 200 && status < 400;
    const ttft_ms = validDuration;
    const total_duration_ms = validDuration;

    // 科学估算真实 TPS (生成速度)
    const gen_secs = (validDuration / 1000) || 0.1;
    const tps = outputTokens > 0
        ? Number(((outputTokens / gen_secs) * 10 / 10).toFixed(1))
        : Number(((1000 / validDuration) * 28).toFixed(1));

    let slack_level: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle' = 'smooth';
    let slack_score = 30;
    let slack_title = '运行平稳 · 节奏适中';
    let slack_advice = '服务延迟处于合理区间，上游响应顺畅，处于最佳工作状态。';

    if (!success) {
        slack_level = 'slack';
        slack_score = 100;
        if (status === 429) {
            slack_title = '官方队列拥塞 · 限流排队';
            slack_advice = '上游接口已达并发上限或触发配额排队，建议离线休息片刻。';
        } else if (status >= 500) {
            slack_title = '上游服务波动 · 建议休息';
            slack_advice = '上游服务器暂时故障，服务不可用，建议稍后再试。';
        } else {
            slack_title = '网络连接异常 · 检查通道';
            slack_advice = '上游请求无法送达，请确认本机代理隧道或网络连通性。';
        }
    } else if (inputTokens >= 20_000 && ttft_ms <= 60_000) {
        // 关键修复：输入达几十万 tokens 超大规模工程时 (例如 760k 输入耗时 14.6s)，这是 GPU 算力全开状态，绝非拥堵！
        const kTokens = Math.round(inputTokens / 1000);
        slack_level = 'sprint';
        slack_score = 10;
        slack_title = `${kTokens}k 上下文 · 算力全开`;
        slack_advice = `正在高效处理 ${kTokens}k 超大规模工程上下文，GPU 吞吐极佳，链路高效稳定。`;
    } else if (ttft_ms < 1200) {
        slack_level = 'sprint';
        slack_score = 5;
        slack_title = '极速响应 · 高效冲刺';
        slack_advice = '上游响应极其丝滑，毫秒级首字吐出，建议保持专注高效产出。';
    } else if (ttft_ms < 3000) {
        slack_level = 'smooth';
        slack_score = 25;
        slack_title = '运行平稳 · 节奏适中';
        slack_advice = '服务延迟处于平稳区间，状态良好，推荐持续推进工作任务。';
    } else if (ttft_ms < 6000) {
        slack_level = 'tea';
        slack_score = 65;
        slack_title = '上游排队迟缓 · 建议稍憩';
        slack_advice = '官方接口出现轻度拥塞（延迟 >3s），建议起身走走、喝口水调整节奏。';
    } else {
        slack_level = 'slack';
        slack_score = 95;
        slack_title = '严重拥堵 · 摸鱼待机';
        slack_advice = '上游处理超过 6 秒，排队迟缓严重，建议适度放松休息。';
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
        input_tokens: inputTokens,
        tps: Math.min(150, Math.max(5, tps)),
        slack_level,
        slack_score,
        slack_title,
        slack_advice,
        is_live_log: isLiveLog,
        timestamp: Math.floor(Date.now() / 1000),
    };
}
