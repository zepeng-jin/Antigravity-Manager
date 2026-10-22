use futures::StreamExt;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

/// 速度探测与摸鱼指数结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedProbeResult {
    pub model: String,
    pub display_name: String,
    pub account_email: String,
    pub success: bool,
    pub status_code: u16,
    pub ttft_ms: u64,           // 首字响应延迟 (Time to First Token)
    pub total_duration_ms: u64, // 完整请求往返总耗时
    pub output_tokens: u32,     // 采样生成 token 数
    pub tps: f64,               // 吐字速率 tokens/s
    pub slack_level: String,    // "sprint" | "smooth" | "tea" | "slack"
    pub slack_score: u32,       // 0 ~ 100 摸鱼指数 (越慢越高)
    pub slack_title: String,    // 状态标语
    pub slack_advice: String,   // 趣味摸鱼/工作建议
    pub error_msg: Option<String>,
    pub timestamp: i64,
}

/// 真实测速模型元信息 (动态汇聚账号配额、官方目录与自定义映射)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeModelInfo {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub source: String, // "account" (账号原生可用) | "custom" (自定义接口) | "official" (官方支持)
}

/// 动态获取当前环境真实可用的模型列表 (严格按实际使用量降序排列)
pub fn get_available_probe_models() -> Vec<ProbeModelInfo> {
    use std::collections::HashSet;
    let mut list = Vec::new();
    let mut seen = HashSet::new();

    // 1. 最高优先级：严格按真实用量降序排列 (使用量最大的主力模型排在首位)
    if let Ok(stats) = crate::modules::token_stats::get_model_stats(0) {
        for s in stats {
            if !s.model.is_empty() && s.total_tokens > 0 && seen.insert(s.model.clone()) {
                let vendor = if s.model.to_lowercase().contains("claude") {
                    "Anthropic".to_string()
                } else if s.model.to_lowercase().contains("gpt") {
                    "OpenAI".to_string()
                } else {
                    "Google".to_string()
                };
                list.push(ProbeModelInfo {
                    id: s.model.clone(),
                    name: s.model.clone(),
                    vendor,
                    source: "usage_rank".to_string(),
                });
            }
        }
    }

    // 2. 补充当前账号配额中真实存在的模型
    if let Ok(accounts) = crate::modules::account::list_accounts() {
        for acc in accounts {
            if let Some(quota) = acc.quota {
                for m in quota.models {
                    if !m.name.is_empty() && seen.insert(m.name.clone()) {
                        let vendor = if m.name.to_lowercase().contains("claude") {
                            "Anthropic".to_string()
                        } else if m.name.to_lowercase().contains("gpt") {
                            "OpenAI".to_string()
                        } else {
                            "Google".to_string()
                        };
                        list.push(ProbeModelInfo {
                            id: m.name.clone(),
                            name: m.name.clone(),
                            vendor,
                            source: "account".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 3. 补充自定义映射接口模型
    if let Ok(cfg) = crate::modules::config::load_app_config() {
        for (k, _) in cfg.proxy.custom_mapping {
            if !k.is_empty() && seen.insert(k.clone()) {
                list.push(ProbeModelInfo {
                    id: k.clone(),
                    name: k,
                    vendor: "Custom".to_string(),
                    source: "custom".to_string(),
                });
            }
        }
    }

    // 4. 补充默认常用主力模型
    for default_m in &["gemini-3.8-flash-high", "claude-3.8-flash-high", "claude-sonnet-4-6", "gemini-2.0-flash"] {
        if seen.insert(default_m.to_string()) {
            list.push(ProbeModelInfo {
                id: default_m.to_string(),
                name: default_m.to_string(),
                vendor: if default_m.contains("claude") { "Anthropic".to_string() } else { "Google".to_string() },
                source: "official".to_string(),
            });
        }
    }

    list
}

/// 根据测速结果与上下文吞吐科学计算摸鱼指数和趣味建议 (结合输入规模与真实算力，杜绝将几十万token长上下文处理误判为拥堵)
pub fn calculate_slack_metrics(
    success: bool,
    ttft_ms: u64,
    input_tokens: u32,
    _output_tokens: u32,
    error_opt: Option<&str>,
) -> (String, u32, String, String) {
    if !success {
        let err = error_opt.unwrap_or("未知异常");
        let (title, advice) = if err.contains("429")
            || err.contains("RESOURCE_EXHAUSTED")
            || err.contains("quota")
        {
            (
                "官方队列拥塞 · 限流排队",
                "上游接口已达并发上限或触发配额排队，建议离线休息片刻。",
            )
        } else if err.contains("500") || err.contains("503") || err.contains("UNAVAILABLE") {
            (
                "上游服务波动 · 建议休息",
                "上游服务器暂时故障，服务不可用，建议稍后再试。",
            )
        } else {
            (
                "网络连接异常 · 检查通道",
                "上游请求无法送达，请确认本机代理隧道或网络连通性。",
            )
        };
        return ("slack".to_string(), 100, title.to_string(), advice.to_string());
    }

    // 针对大上下文工程场景 (例如 50k~760k tokens 输入)：
    // GPU 预填充庞大矩阵本身需要数秒运算，在 60s 内成功返回属于极高吞吐的算力全开状态，绝非拥堵！
    if input_tokens >= 20_000 && ttft_ms <= 60_000 {
        let k_tokens = input_tokens / 1000;
        let title = format!("{}k 上下文 · 算力全开", k_tokens);
        let advice = format!(
            "正在高速处理 {}k 超大规模工程上下文，GPU 吞吐极佳，链路高效稳定。",
            k_tokens
        );
        return ("sprint".to_string(), 10, title, advice);
    }

    // 常规轻量请求场景：
    if ttft_ms < 1200 {
        (
            "sprint".to_string(),
            5,
            "极速响应 · 高效冲刺".to_string(),
            "上游响应极其丝滑，毫秒级首字吐出，建议保持专注高效产出。".to_string(),
        )
    } else if ttft_ms < 3000 {
        (
            "smooth".to_string(),
            25,
            "运行平稳 · 节奏适中".to_string(),
            "服务延迟处于平稳区间，状态良好，推荐持续推进工作任务。".to_string(),
        )
    } else if ttft_ms < 6000 {
        (
            "tea".to_string(),
            65,
            "上游排队迟缓 · 建议稍憩".to_string(),
            "官方接口出现排队（延迟 >3s），建议起身走走、喝口水调整节奏。".to_string(),
        )
    } else {
        (
            "slack".to_string(),
            95,
            "严重拥堵 · 摸鱼待机".to_string(),
            "上游响应超过 6 秒，排队迟缓严重，建议适度放松休息。".to_string(),
        )
    }
}

/// 执行单个模型的轻量主动速度探测
pub async fn probe_single_model_speed(
    model_name: &str,
    account_email_opt: Option<&str>,
) -> Result<SpeedProbeResult, String> {
    let now = chrono::Local::now().timestamp();

    // 1. 获取可用账号列表
    let accounts = crate::modules::account::list_accounts().map_err(|e| e.to_string())?;
    let active_acc = if let Some(target_email) = account_email_opt {
        accounts.into_iter().find(|a| a.email == target_email)
    } else {
        accounts
            .into_iter()
            .find(|a| !a.disabled && !a.validation_blocked && !a.quota.as_ref().map(|q| q.is_forbidden).unwrap_or(false))
    }
    .ok_or_else(|| "未找到可用正常账号，请先在账号页面添加或启用账号".to_string())?;

    let account_email = active_acc.email.clone();
    let account_id = active_acc.id.clone();

    // 2. 获取有效鉴权凭证
    let (access_token, project_id) =
        crate::modules::quota::get_valid_token_for_warmup(&active_acc).await?;

    // 3. 构建轻量探针报文并进行核心模型路由映射（结合用户自定义接口映射表）
    let custom_mapping = crate::modules::config::load_app_config()
        .map(|c| c.proxy.custom_mapping)
        .unwrap_or_default();

    let mapped_model = crate::proxy::common::model_mapping::resolve_model_route_with_effort(
        model_name,
        &custom_mapping,
        None,
    );

    let is_claude = mapped_model.to_lowercase().contains("claude")
        || model_name.to_lowercase().contains("claude");
    let session_id = format!("speed_probe_{}", chrono::Utc::now().timestamp_millis());

    let body_res: Result<Value, String> = if is_claude {
        let claude_request = crate::proxy::mappers::claude::models::ClaudeRequest {
            model: mapped_model.clone(),
            messages: vec![crate::proxy::mappers::claude::models::Message {
                role: "user".to_string(),
                content: crate::proxy::mappers::claude::models::MessageContent::String(
                    "ping".to_string(),
                ),
            }],
            max_tokens: Some(3),
            stream: true,
            system: None,
            temperature: Some(0.0),
            top_p: None,
            top_k: None,
            tools: None,
            metadata: Some(crate::proxy::mappers::claude::models::Metadata {
                user_id: Some(session_id.clone()),
            }),
            thinking: None,
            output_config: None,
            size: None,
            quality: None,
            tool_choice: None,
        };
        crate::proxy::mappers::claude::transform_claude_request_in(
            &claude_request,
            &project_id,
            false,
            None,
            "probe",
            None,
        )
    } else {
        let base_request = serde_json::json!({
            "model": mapped_model,
            "contents": [{"role": "user", "parts": [{"text": "1+1="}]}],
            "generationConfig": {
                "maxOutputTokens": 3,
                "temperature": 0.0,
                "responseModalities": ["TEXT"]
            },
            "session_id": session_id
        });
        Ok(crate::proxy::mappers::gemini::wrapper::wrap_request(
            &base_request,
            &project_id,
            &mapped_model,
            None,
            Some(&session_id),
            None,
        ))
    };

    let body = body_res?;

    let display_name = match model_name {
        "gemini-3.8-flash-high" | "gemini-3.8-flash" => "Gemini 3.8 Flash",
        "claude-3.8-flash-high" | "claude-3.8-flash" => "Claude 3.8 Flash",
        "claude-sonnet-4-6" => "Claude Sonnet 4.6",
        "claude-3-5-sonnet" => "Claude 3.5 Sonnet",
        "gemini-2.0-flash" => "Gemini 2.0 Flash",
        "gemini-1.5-pro" => "Gemini 1.5 Pro",
        other => other,
    }
    .to_string();

    // 4. 双通道智能测速：优先复用本地已启动的代理服务网关链路（100% 走通用户代理环境）
    let app_config = crate::modules::config::load_app_config().unwrap_or_default();
    let port = app_config.proxy.port;
    let warmup_url = format!("http://127.0.0.1:{}/internal/warmup", port);
    let probe_payload = serde_json::json!({
        "email": account_email,
        "model": mapped_model,
        "access_token": access_token,
        "project_id": project_id,
        "account_id": account_id,
    });

    let local_loopback_client = rquest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
        .unwrap_or_else(|_| rquest::Client::new());

    let loopback_start = Instant::now();
    let loopback_res = local_loopback_client
        .post(&warmup_url)
        .header("Content-Type", "application/json")
        .json(&probe_payload)
        .send()
        .await;

    // 通道 A：如果本地反代在线，直接通过反代网关完成测速（真实测量用户反代链路）
    if let Ok(resp) = loopback_res {
        let total_duration_ms = loopback_start.elapsed().as_millis() as u64;
        let status = resp.status();
        let status_code = status.as_u16();

        if status.is_success() {
            // 解析返回的 JSON，获取服务端内部测量到的耗时
            let warmup_json: serde_json::Value = resp.json().await.unwrap_or_default();
            let upstream_duration = warmup_json.get("duration_ms").and_then(|v| v.as_u64()).unwrap_or(total_duration_ms);
            let ttft_ms = upstream_duration.min(total_duration_ms);

            // 采样估算 TPS
            let tps = if ttft_ms > 0 {
                ((1000.0 / (ttft_ms as f64) * 32.0 * 10.0).round() / 10.0).min(120.0).max(12.0)
            } else {
                45.0
            };

            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(true, ttft_ms, 3, 3, None);

            return Ok(SpeedProbeResult {
                model: model_name.to_string(),
                display_name,
                account_email,
                success: true,
                status_code: 200,
                ttft_ms,
                total_duration_ms,
                output_tokens: 3,
                tps,
                slack_level,
                slack_score,
                slack_title,
                slack_advice,
                error_msg: None,
                timestamp: now,
            });
        } else {
            let err_text = resp.text().await.unwrap_or_default();
            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(false, total_duration_ms, 0, 0, Some(&err_text));

            return Ok(SpeedProbeResult {
                model: model_name.to_string(),
                display_name,
                account_email,
                success: false,
                status_code,
                ttft_ms: total_duration_ms,
                total_duration_ms,
                output_tokens: 0,
                tps: 0.0,
                slack_level,
                slack_score,
                slack_title,
                slack_advice,
                error_msg: Some(err_text),
                timestamp: now,
            });
        }
    }

    // 通道 B（降级）：反代未启动时，必须使用用户配置的 upstream_proxy（科学代理）直连上游
    let up_proxy = app_config.proxy.upstream_proxy;
    let proxy_opt = if up_proxy.enabled && !up_proxy.url.trim().is_empty() {
        Some(up_proxy)
    } else {
        None
    };

    let upstream_client = crate::proxy::upstream::client::UpstreamClient::new(proxy_opt, None);
    let start_instant = Instant::now();

    let call_res: Result<crate::proxy::upstream::client::UpstreamCallResult, String> = upstream_client
        .call_v1_internal(
            "streamGenerateContent",
            &access_token,
            body.clone(),
            Some("alt=sse"),
            Some(&account_id),
        )
        .await;

    match call_res {
        Ok(call_result) => {
            let response = call_result.response;
            let status = response.status();
            let status_code = status.as_u16();

            if !status.is_success() {
                let err_text = response.text().await.unwrap_or_default();
                let total_duration_ms = start_instant.elapsed().as_millis() as u64;
                let (slack_level, slack_score, slack_title, slack_advice) =
                    calculate_slack_metrics(false, total_duration_ms, 0, 0, Some(&err_text));

                return Ok(SpeedProbeResult {
                    model: model_name.to_string(),
                    display_name,
                    account_email,
                    success: false,
                    status_code,
                    ttft_ms: total_duration_ms,
                    total_duration_ms,
                    output_tokens: 0,
                    tps: 0.0,
                    slack_level,
                    slack_score,
                    slack_title,
                    slack_advice,
                    error_msg: Some(err_text),
                    timestamp: now,
                });
            }

            // 读取流式响应并测量首字延迟 TTFT
            let mut stream = response.bytes_stream();
            let mut first_token_ms: Option<u64> = None;
            let mut total_output_tokens = 0;

            while let Some(chunk_res) = stream.next().await {
                if let Ok(chunk) = chunk_res {
                    if !chunk.is_empty() {
                        if first_token_ms.is_none() {
                            first_token_ms = Some(start_instant.elapsed().as_millis() as u64);
                        }
                        total_output_tokens += 1;
                    }
                }
            }

            let total_duration_ms = start_instant.elapsed().as_millis() as u64;
            let ttft_ms = first_token_ms.unwrap_or(total_duration_ms);

            let gen_duration_ms = total_duration_ms.saturating_sub(ttft_ms).max(20);
            let tps = ((total_output_tokens as f64) / ((gen_duration_ms as f64) / 1000.0) * 10.0)
                .round()
                / 10.0;

            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(true, ttft_ms, 3, total_output_tokens, None);

            Ok(SpeedProbeResult {
                model: model_name.to_string(),
                display_name,
                account_email,
                success: true,
                status_code: 200,
                ttft_ms,
                total_duration_ms,
                output_tokens: total_output_tokens,
                tps: tps.max(1.0),
                slack_level,
                slack_score,
                slack_title,
                slack_advice,
                error_msg: None,
                timestamp: now,
            })
        }
        Err(err) => {
            let total_duration_ms = start_instant.elapsed().as_millis() as u64;
            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(false, total_duration_ms, 0, 0, Some(&err));

            Ok(SpeedProbeResult {
                model: model_name.to_string(),
                display_name,
                account_email,
                success: false,
                status_code: 500,
                ttft_ms: total_duration_ms,
                total_duration_ms,
                output_tokens: 0,
                tps: 0.0,
                slack_level,
                slack_score,
                slack_title,
                slack_advice,
                error_msg: Some(err.to_string()),
                timestamp: now,
            })
        }
    }
}

/// 批量执行真实模型速度探测 (前6个真实活跃模型)
pub async fn probe_all_models_speed() -> Result<Vec<SpeedProbeResult>, String> {
    let targets = get_available_probe_models();
    let mut results = Vec::new();

    for target in targets.into_iter().take(6) {
        match probe_single_model_speed(&target.id, None).await {
            Ok(res) => results.push(res),
            Err(e) => {
                let (slack_level, slack_score, slack_title, slack_advice) =
                    calculate_slack_metrics(false, 9999, 0, 0, Some(&e));
                results.push(SpeedProbeResult {
                    model: target.id.clone(),
                    display_name: target.name.clone(),
                    account_email: "".to_string(),
                    success: false,
                    status_code: 500,
                    ttft_ms: 9999,
                    total_duration_ms: 9999,
                    output_tokens: 0,
                    tps: 0.0,
                    slack_level,
                    slack_score,
                    slack_title,
                    slack_advice,
                    error_msg: Some(e),
                    timestamp: chrono::Local::now().timestamp(),
                });
            }
        }
    }

    Ok(results)
}

/// 过去 1 分钟滑动负载窗口统计指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneMinuteLoadMetrics {
    pub window_seconds: u32,
    pub request_count: u32,
    pub success_count: u32,
    pub rate_limit_count: u32,
    pub error_count: u32,
    pub model: String,
    pub display_name: String,
    pub avg_ttft_ms: u64,
    pub avg_duration_ms: u64,
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub tps: f64,
    pub slack_level: String,
    pub slack_score: u32,
    pub slack_title: String,
    pub slack_advice: String,
    pub is_idle: bool,
    pub last_active_timestamp: i64,
    pub timestamp: i64,
}

/// 直接从数据库/监控日志提取最近 1 条真实业务请求，换算精准 TTFT、TPS 与摸鱼指数
pub fn get_latest_real_request_speed() -> Result<Option<SpeedProbeResult>, String> {
    let logs = crate::modules::proxy_db::get_logs_summary(10, 0)?;
    for log in logs {
        if log.url.contains("health") || log.url.contains("event_logging") {
            continue;
        }
        if log.duration > 0 {
            let model = log.model.unwrap_or_else(|| "unknown".to_string());
            let status = log.status;
            let duration_ms = log.duration;
            let input_tokens = log.input_tokens.unwrap_or(0);
            let output_tokens = log.output_tokens.unwrap_or(0);
            let account_email = log.account_email.unwrap_or_default();
            let timestamp_secs = log.timestamp / 1000;

            let mut parsed_ttft = log.ttft;
            let mut parsed_stream = None;
            if let Some(ref h_str) = log.response_headers {
                if let Ok(val) = serde_json::from_str::<Value>(h_str) {
                    if parsed_ttft.is_none() {
                        if let Some(t) = val
                            .get("x-timing-ttft-ms")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.parse::<f64>().ok())
                        {
                            parsed_ttft = Some(t.round() as u64);
                        }
                    }
                    if let Some(s) = val
                        .get("x-timing-stream-ms")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                    {
                        parsed_stream = Some(s);
                    }
                }
            }

            let ttft_ms = parsed_ttft.unwrap_or(duration_ms);
            let stream_ms = parsed_stream.unwrap_or_else(|| duration_ms.saturating_sub(ttft_ms) as f64);
            let gen_secs = (stream_ms / 1000.0).max(0.05);
            let tps = if output_tokens > 0 {
                ((output_tokens as f64 / gen_secs) * 10.0).round() / 10.0
            } else {
                ((1000.0 / ttft_ms.max(50) as f64) * 28.0 * 10.0).round() / 10.0
            };

            let success = status >= 200 && status < 400;
            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(success, ttft_ms, input_tokens, output_tokens, log.error.as_deref());

            return Ok(Some(SpeedProbeResult {
                model: model.clone(),
                display_name: model,
                account_email,
                success,
                status_code: status,
                ttft_ms,
                total_duration_ms: duration_ms,
                output_tokens,
                tps: tps.min(250.0).max(1.0),
                slack_level,
                slack_score,
                slack_title,
                slack_advice,
                error_msg: log.error,
                timestamp: timestamp_secs,
            }));
        }
    }
    Ok(None)
}

/// 核心：计算前 1 分钟滑动负载窗口统计指标 (解决单次瞬时请求跳变、缺乏全局负载表征的问题)
pub fn get_one_minute_rolling_load(target_model: Option<&str>) -> Result<OneMinuteLoadMetrics, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let one_min_ago = now_ms - 60_000;
    let now_secs = now_ms / 1000;

    let conn = crate::modules::proxy_db::connect_db()?;

    // 1. 查询过去 60 秒内的所有真实业务请求 (按时间倒序)
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, status, duration, model, input_tokens, output_tokens, error, response_headers
             FROM request_logs
             WHERE timestamp >= ?1 AND url NOT LIKE '%health%' AND url NOT LIKE '%event_logging%'
             ORDER BY timestamp DESC",
        )
        .map_err(|e| e.to_string())?;

    struct RecentRow {
        status: u16,
        duration: u64,
        model: Option<String>,
        input_tokens: u32,
        output_tokens: u32,
        error: Option<String>,
        ttft_ms: u64,
        stream_ms: f64,
    }

    let rows_iter = stmt
        .query_map([one_min_ago], |row| {
            let status: u16 = row.get(2)?;
            let duration: u64 = row.get(3)?;
            let model: Option<String> = row.get(4)?;
            let input_tokens: u32 = row.get::<_, Option<u32>>(5)?.unwrap_or(0);
            let output_tokens: u32 = row.get::<_, Option<u32>>(6)?.unwrap_or(0);
            let error: Option<String> = row.get(7)?;
            let resp_headers_str: Option<String> = row.get(8)?;

            let mut parsed_ttft = None;
            let mut parsed_stream = None;
            if let Some(ref h_str) = resp_headers_str {
                if let Ok(val) = serde_json::from_str::<Value>(h_str) {
                    if let Some(t) = val
                        .get("x-timing-ttft-ms")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                    {
                        parsed_ttft = Some(t.round() as u64);
                    }
                    if let Some(s) = val
                        .get("x-timing-stream-ms")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                    {
                        parsed_stream = Some(s);
                    }
                }
            }

            let ttft_ms = parsed_ttft.unwrap_or(duration);
            let stream_ms = parsed_stream.unwrap_or_else(|| duration.saturating_sub(ttft_ms) as f64);

            Ok(RecentRow {
                status,
                duration,
                model,
                input_tokens,
                output_tokens,
                error,
                ttft_ms,
                stream_ms,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut recent_requests = Vec::new();
    for r in rows_iter {
        recent_requests.push(r.map_err(|e| e.to_string())?);
    }

    // 2. 查询最近一次历史请求的时间和模型（当近 1 分钟无请求时提供参考）
    let last_active: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT timestamp, model FROM request_logs WHERE url NOT LIKE '%health%' AND url NOT LIKE '%event_logging%' ORDER BY timestamp DESC LIMIT 1",
            [],
            |row| {
                let ts: i64 = row.get(0)?;
                let m: Option<String> = row.get(1)?;
                Ok((ts / 1000, m))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (last_active_ts, last_model) = last_active.unwrap_or((0, None));

    let default_model = "gemini-3.8-flash-high".to_string();
    let selected_model = target_model
        .map(|s| s.to_string())
        .or_else(|| recent_requests.first().and_then(|r| r.model.clone()))
        .or(last_model)
        .unwrap_or(default_model);

    let display_name = selected_model.clone();
    let req_count = recent_requests.len() as u32;

    if req_count == 0 {
        return Ok(OneMinuteLoadMetrics {
            window_seconds: 60,
            request_count: 0,
            success_count: 0,
            rate_limit_count: 0,
            error_count: 0,
            model: selected_model,
            display_name,
            avg_ttft_ms: 0,
            avg_duration_ms: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            tps: 0.0,
            slack_level: "idle".to_string(),
            slack_score: 0,
            slack_title: "近1分钟待机 · 系统就绪".to_string(),
            slack_advice: "最近 1 分钟无上游调用负载，通道就绪，可随时开启工作或点击即刻测速。".to_string(),
            is_idle: true,
            last_active_timestamp: last_active_ts,
            timestamp: now_secs,
        });
    }

    let mut success_count = 0;
    let mut rate_limit_count = 0;
    let mut error_count = 0;
    let mut sum_ttft: u64 = 0;
    let mut sum_duration: u64 = 0;
    let mut total_input: u32 = 0;
    let mut total_output: u32 = 0;
    let mut total_stream_ms: f64 = 0.0;

    for r in &recent_requests {
        if r.status >= 200 && r.status < 400 {
            success_count += 1;
        } else if r.status == 429 {
            rate_limit_count += 1;
        } else {
            error_count += 1;
        }
        sum_ttft += r.ttft_ms;
        sum_duration += r.duration;
        total_input += r.input_tokens;
        total_output += r.output_tokens;
        total_stream_ms += r.stream_ms;
    }

    let avg_ttft = sum_ttft / req_count as u64;
    let avg_duration = sum_duration / req_count as u64;

    let gen_secs = (total_stream_ms / 1000.0).max(0.1);
    let tps = if total_output > 0 {
        ((total_output as f64 / gen_secs) * 10.0).round() / 10.0
    } else {
        ((1000.0 / avg_ttft.max(50) as f64) * 28.0 * 10.0).round() / 10.0
    };

    let (slack_level, slack_score, slack_title, slack_advice) = if rate_limit_count > 0 {
        (
            "slack".to_string(),
            100,
            format!("前1分钟触发限流 · 出现 {} 次429", rate_limit_count),
            "近 1 分钟检测到上游配额耗尽或并发过载排队，官方接口受限，建议离线休息片刻。".to_string(),
        )
    } else if error_count > 0 && success_count == 0 {
        (
            "slack".to_string(),
            95,
            "前1分钟服务波动 · 请求失败".to_string(),
            "近 1 分钟上游接口无成功响应，网络或服务暂时不可用，建议检查网络或稍后重试。".to_string(),
        )
    } else if total_input >= 20_000 && avg_ttft <= 60_000 {
        let k_tokens = total_input / 1000;
        let title = format!("前1分钟 {}k 吞吐 · 算力全开", k_tokens);
        let advice = format!(
            "近 1 分钟完成 {} 笔请求，处理 {}k 超大规模工程上下文，GPU 吞吐极佳，链路高效稳定。",
            req_count, k_tokens
        );
        ("sprint".to_string(), 10, title, advice)
    } else if avg_ttft < 1200 {
        (
            "sprint".to_string(),
            5,
            format!("前1分钟极速响应 · {} req/min", req_count),
            "近 1 分钟上游响应极佳，毫秒级首字吐出，建议保持专注高效产出。".to_string(),
        )
    } else if avg_ttft < 3000 {
        (
            "smooth".to_string(),
            25,
            format!("前1分钟平稳顺畅 · {} req/min", req_count),
            "近 1 分钟服务延迟处于平稳区间，状态良好，推荐持续推进工作任务。".to_string(),
        )
    } else if avg_ttft < 6000 {
        (
            "tea".to_string(),
            65,
            format!("前1分钟排队迟缓 · {} req/min", req_count),
            "近 1 分钟官方接口出现排队（平均首字 >3s），建议起身走走、喝口水调整节奏。".to_string(),
        )
    } else {
        (
            "slack".to_string(),
            95,
            format!("前1分钟严重拥堵 · {} req/min", req_count),
            "近 1 分钟上游平均响应超过 6 秒，排队迟缓严重，建议适度放松休息。".to_string(),
        )
    };

    Ok(OneMinuteLoadMetrics {
        window_seconds: 60,
        request_count: req_count,
        success_count,
        rate_limit_count,
        error_count,
        model: selected_model,
        display_name,
        avg_ttft_ms: avg_ttft,
        avg_duration_ms: avg_duration,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        tps: tps.min(250.0).max(1.0),
        slack_level,
        slack_score,
        slack_title,
        slack_advice,
        is_idle: false,
        last_active_timestamp: last_active_ts,
        timestamp: now_secs,
    })
}

