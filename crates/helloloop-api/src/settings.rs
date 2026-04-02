use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use helloloop_domain::HelloAppSettings;

use crate::ApiState;

pub(crate) async fn get_settings(
    State(state): State<ApiState>,
) -> Result<Json<HelloAppSettings>, StatusCode> {
    state
        .store
        .settings()
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(crate) async fn update_settings(
    State(state): State<ApiState>,
    Json(settings): Json<HelloAppSettings>,
) -> Result<Json<HelloAppSettings>, StatusCode> {
    state
        .store
        .save_settings(&settings)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
