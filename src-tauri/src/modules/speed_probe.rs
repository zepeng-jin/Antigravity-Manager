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

/// 支持的主流测速模型配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeModelTarget {
    pub id: String,
    pub name: String,
    pub vendor: String,
}

pub fn get_default_probe_targets() -> Vec<ProbeModelTarget> {
    vec![
        ProbeModelTarget {
            id: "gemini-3.8-flash-high".to_string(),
            name: "Gemini 3.8 Flash".to_string(),
            vendor: "Google".to_string(),
        },
        ProbeModelTarget {
            id: "claude-3.8-flash-high".to_string(),
            name: "Claude 3.8 Flash".to_string(),
            vendor: "Anthropic".to_string(),
        },
        ProbeModelTarget {
            id: "claude-sonnet-4-6".to_string(),
            name: "Claude Sonnet 4.6".to_string(),
            vendor: "Anthropic".to_string(),
        },
        ProbeModelTarget {
            id: "gemini-2.0-flash".to_string(),
            name: "Gemini 2.0 Flash".to_string(),
            vendor: "Google".to_string(),
        },
        ProbeModelTarget {
            id: "gemini-1.5-pro".to_string(),
            name: "Gemini 1.5 Pro".to_string(),
            vendor: "Google".to_string(),
        },
    ]
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
                "🚨 官方限流排队 · 奉旨摸鱼 🎮",
                "上游接口触发频率限制或配额排队，非战之罪，请理直气壮去摸鱼！",
            )
        } else if err.contains("500") || err.contains("503") || err.contains("UNAVAILABLE") {
            (
                "⚠️ 官方服务波动 · 建议喝茶 🍵",
                "上游服务器暂时故障中，服务不可用，建议去泡杯茶稍后再试。",
            )
        } else {
            (
                "❌ 探针连接受阻 · 建议检查网络 🌐",
                "无法连接上游 API，请检查本机代理或网络连通性。",
            )
        };
        return ("slack".to_string(), 100, title.to_string(), advice.to_string());
    }

    if ttft_ms < 650 {
        (
            "sprint".to_string(),
            5,
            "⚡️ 极速狂飙 · 搬砖效率翻倍 🚀".to_string(),
            "上游响应极其丝滑，毫秒级首字吐出，趁现在灵感爆发疯狂输出代码！".to_string(),
        )
    } else if ttft_ms < 1400 {
        (
            "smooth".to_string(),
            30,
            "💻 节奏平稳 · 专注干活 💼".to_string(),
            "服务延迟适中稳定，上游状态良好，一杯茶一包烟，一行代码写一天。".to_string(),
        )
    } else if ttft_ms < 2800 {
        (
            "tea".to_string(),
            70,
            "☕️ 上游迟缓 · 适度摸鱼 🍵".to_string(),
            "官方接口排队中，延迟明显偏高（>1.5s），建议起身走走、活动肩颈。".to_string(),
        )
    } else {
        (
            "slack".to_string(),
            95,
            "🏖️ 深度拥堵 · 奉旨摸鱼 😴".to_string(),
            "上游响应超过 2.8 秒，排队严重。系统批准摸鱼，去打把游戏吧！".to_string(),
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

    // 3. 构建轻量探针报文并进行核心模型路由映射
    let empty_map = std::collections::HashMap::new();
    let mapped_model = crate::proxy::common::model_mapping::resolve_model_route(
        model_name,
        &empty_map,
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

    // 4. 创建上游客户端并启动计时
    let upstream_client = crate::proxy::upstream::client::UpstreamClient::new(None, None);
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

/// 批量执行全主流模型速度探测
pub async fn probe_all_models_speed() -> Result<Vec<SpeedProbeResult>, String> {
    let targets = get_default_probe_targets();
    let mut results = Vec::new();

    for target in targets {
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
