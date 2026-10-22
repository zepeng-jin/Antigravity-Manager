use futures::StreamExt;
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

/// 根据测速结果计算摸鱼指数和趣味建议
pub fn calculate_slack_metrics(
    success: bool,
    ttft_ms: u64,
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

    if ttft_ms < 650 {
        (
            "sprint".to_string(),
            5,
            "极速响应 · 高效冲刺".to_string(),
            "上游响应极其丝滑，毫秒级首字吐出，建议保持专注高效产出。".to_string(),
        )
    } else if ttft_ms < 1400 {
        (
            "smooth".to_string(),
            30,
            "运行平稳 · 节奏适中".to_string(),
            "服务延迟处于平稳区间，状态良好，推荐持续推进工作任务。".to_string(),
        )
    } else if ttft_ms < 2800 {
        (
            "tea".to_string(),
            70,
            "上游排队迟缓 · 建议稍憩".to_string(),
            "官方接口出现轻度拥塞（延迟 >1.5s），建议起身走走、喝口水调整节奏。".to_string(),
        )
    } else {
        (
            "slack".to_string(),
            95,
            "严重拥堵 · 摸鱼待机".to_string(),
            "上游处理超过 2.8 秒，排队迟缓严重，建议适度放松休息。".to_string(),
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
        "model": model_name,
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
                calculate_slack_metrics(true, ttft_ms, None);

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
                calculate_slack_metrics(false, total_duration_ms, Some(&err_text));

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
                    calculate_slack_metrics(false, total_duration_ms, Some(&err_text));

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
                calculate_slack_metrics(true, ttft_ms, None);

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
                calculate_slack_metrics(false, total_duration_ms, Some(&err));

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
                    calculate_slack_metrics(false, 9999, Some(&e));
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

/// 直接从数据库/监控日志提取最近 1 条真实业务请求，直接换算速度与摸鱼指数 (解决明明在使用却显示待机空闲问题)
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
            let output_tokens = log.output_tokens.unwrap_or(0);
            let account_email = log.account_email.unwrap_or_default();
            let timestamp_secs = log.timestamp / 1000;

            let ttft_ms = duration_ms;
            let gen_secs = (duration_ms as f64 / 1000.0).max(0.1);
            let tps = if output_tokens > 0 {
                ((output_tokens as f64 / gen_secs) * 10.0).round() / 10.0
            } else {
                ((1000.0 / duration_ms as f64) * 28.0 * 10.0).round() / 10.0
            };

            let success = status >= 200 && status < 400;
            let (slack_level, slack_score, slack_title, slack_advice) =
                calculate_slack_metrics(success, ttft_ms, log.error.as_deref());

            return Ok(Some(SpeedProbeResult {
                model: model.clone(),
                display_name: model,
                account_email,
                success,
                status_code: status,
                ttft_ms,
                total_duration_ms: duration_ms,
                output_tokens,
                tps: tps.min(120.0).max(1.0),
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

