use axum::extract::Path;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{Html, IntoResponse, Redirect, Response};

const APP_INDEX_HTML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../apps/hello-app/web/index.html"
));
const APP_CSS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../apps/hello-app/web/app.css"
));
const APP_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../apps/hello-app/web/app.js"
));

pub async fn app_redirect() -> Redirect {
    Redirect::permanent("/app/")
}

pub async fn app_shell() -> Html<&'static str> {
    Html(APP_INDEX_HTML)
}

pub async fn app_asset(Path(asset): Path<String>) -> Response {
    match asset.as_str() {
        "app.css" => text_response("text/css; charset=utf-8", APP_CSS),
        "app.js" => text_response("application/javascript; charset=utf-8", APP_JS),
        "app-i18n.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-i18n.js"
            )),
        ),
        "app-http.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-http.js"
            )),
        ),
        "app-state-support.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-state-support.js"
            )),
        ),
        "app-render.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-render.js"
            )),
        ),
        "app-render-parts.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-render-parts.js"
            )),
        ),
        "app-render-cards.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-render-cards.js"
            )),
        ),
        "app-render-views.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-render-views.js"
            )),
        ),
        "app-view-shared.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-shared.js"
            )),
        ),
        "app-view-command.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-command.js"
            )),
        ),
        "app-view-workspaces.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-workspaces.js"
            )),
        ),
        "app-view-workspaces-parts.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-workspaces-parts.js"
            )),
        ),
        "app-view-sessions.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-sessions.js"
            )),
        ),
        "app-view-tasks.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-tasks.js"
            )),
        ),
        "app-view-review.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-review.js"
            )),
        ),
        "app-view-settings.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-view-settings.js"
            )),
        ),
        "app-locales-zh.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-locales-zh.js"
            )),
        ),
        "app-locales-en.js" => text_response(
            "application/javascript; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-locales-en.js"
            )),
        ),
        "app-theme.css" => text_response(
            "text/css; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-theme.css"
            )),
        ),
        "app-layout.css" => text_response(
            "text/css; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-layout.css"
            )),
        ),
        "app-components.css" => text_response(
            "text/css; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-components.css"
            )),
        ),
        "app-forms.css" => text_response(
            "text/css; charset=utf-8",
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/hello-app/web/app-forms.css"
            )),
        ),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn text_response(content_type: &'static str, body: &'static str) -> Response {
    (
        [(header::CONTENT_TYPE, HeaderValue::from_static(content_type))],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{app_asset, app_shell};
    use axum::body::to_bytes;
    use axum::extract::Path;
    use axum::response::Html;

    #[tokio::test]
    async fn serves_app_shell_html() {
        let Html(body) = app_shell().await;
        assert!(body.contains("Hello App"));
        assert!(body.contains("/app/app.js"));
    }

    #[tokio::test]
    async fn serves_static_assets() {
        let response = app_asset(Path("app.js".to_string())).await;
        assert_eq!(response.status(), 200);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("asset body should be readable");
        let text = String::from_utf8(body.to_vec()).expect("asset should be utf-8");
        assert!(text.contains("./app-render.js"));

        let parts_response = app_asset(Path("app-render-parts.js".to_string())).await;
        assert_eq!(parts_response.status(), 200);
        let parts_body = to_bytes(parts_response.into_body(), usize::MAX)
            .await
            .expect("parts asset body should be readable");
        let parts_text =
            String::from_utf8(parts_body.to_vec()).expect("parts asset should be utf-8");
        assert!(parts_text.contains("./app-render-cards.js"));

        let state_response = app_asset(Path("app-state-support.js".to_string())).await;
        assert_eq!(state_response.status(), 200);
        let state_body = to_bytes(state_response.into_body(), usize::MAX)
            .await
            .expect("state asset body should be readable");
        let state_text =
            String::from_utf8(state_body.to_vec()).expect("state asset should be utf-8");
        assert!(state_text.contains("normalizeWorkspaceSnapshot"));

        let http_response = app_asset(Path("app-http.js".to_string())).await;
        assert_eq!(http_response.status(), 200);

        let workspaces_parts_response =
            app_asset(Path("app-view-workspaces-parts.js".to_string())).await;
        assert_eq!(workspaces_parts_response.status(), 200);
    }
}
