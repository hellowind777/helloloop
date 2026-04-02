use helloloop_domain::HostKind;
use helloloop_runtime::HostDescriptor;

pub fn descriptor() -> HostDescriptor {
    HostDescriptor::new(
        HostKind::Gemini,
        "Gemini CLI",
        vec!["gemini".to_string()],
        true,
        true,
        false,
        "Host adapter bootstrap for Gemini CLI",
    )
}
