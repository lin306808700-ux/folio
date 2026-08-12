/**
 * WGSL shaders for the Muse Brain Logo (WebGPU particle neural network)
 */

export const PARTICLE_SHADER = /* wgsl */ `
struct Globals {
    base_color: vec4<f32>,
    pulse_color: vec4<f32>,
    time: f32,
    breath_phase: f32,
    pulse_intensity: f32,
    discharge_intensity: f32,
};

@group(0) @binding(0) var<uniform> globals: Globals;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) brightness: f32,
    @location(2) pulse: f32,
};

@vertex
fn vs_particle(
    @builtin(vertex_index) vi: u32,
    @location(0) inst_pos: vec3<f32>,
    @location(1) brightness: f32,
) -> VertexOutput {
    let quad_uv = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    );
    let uv = quad_uv[vi];
    let size = 0.016 + brightness * 0.018;
    let ndc_pos = inst_pos.xy + uv * size;

    var out: VertexOutput;
    out.position = vec4<f32>(ndc_pos, 0.0, 1.0);
    out.uv = uv;
    out.brightness = brightness;
    out.pulse = globals.pulse_intensity;
    return out;
}

@fragment
fn fs_particle(
    @location(0) uv: vec2<f32>,
    @location(1) brightness: f32,
    @location(2) pulse: f32,
) -> @location(0) vec4<f32> {
    let dist = length(uv);
    if (dist > 1.0) { discard; }

    // Lightning branches from center outward
    var lightning_intensity = 0.0;
    let num_branches = 5;
    for (var i = 0; i < num_branches; i++) {
        let angle = (f32(i) / f32(num_branches)) * 6.2831853 + globals.time * 0.4;
        let branch_dir = vec2<f32>(cos(angle), sin(angle));
        let proj = dot(uv, branch_dir);
        let perp = abs(dot(uv, vec2<f32>(-branch_dir.y, branch_dir.x)));
        let branch_width = 0.1 * (1.0 - proj * 0.7);
        let jitter = sin(proj * 35.0 + globals.time * 6.0) * 0.025 +
                     sin(proj * 70.0 - globals.time * 9.0) * 0.012;
        if (proj > 0.0 && proj < 0.85 && perp < branch_width + jitter) {
            let branch_glow = exp(-perp / (branch_width * 0.35)) * (1.0 - proj);
            lightning_intensity = max(lightning_intensity, branch_glow);
        }
    }

    // Soft glow falloff
    let glow = exp(-dist * 3.0);
    let core = exp(-dist * 8.0);

    let base_color = globals.base_color.rgb;
    let pulse_color = globals.pulse_color.rgb;
    let color = mix(base_color, pulse_color, clamp(pulse, 0.0, 1.0) * 0.75) * brightness;

    let lightning_color = pulse_color * lightning_intensity * globals.discharge_intensity;
    let alpha = (glow * 0.4 + core * 0.8) * brightness + lightning_intensity * 0.6;

    return vec4<f32>(color * (glow + core * 2.0) + lightning_color, alpha);
}
`

export const LINE_SHADER = /* wgsl */ `
struct Globals {
    base_color: vec4<f32>,
    pulse_color: vec4<f32>,
    time: f32,
    breath_phase: f32,
    pulse_intensity: f32,
    discharge_intensity: f32,
};

@group(0) @binding(0) var<uniform> globals: Globals;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) alpha: f32,
};

@vertex
fn vs_line(
    @location(0) pos: vec3<f32>,
    @location(1) alpha: f32,
) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos.xy, 0.0, 1.0);
    out.alpha = alpha;
    return out;
}

@fragment
fn fs_line(@location(0) alpha: f32) -> @location(0) vec4<f32> {
    let color = mix(globals.base_color.rgb, globals.pulse_color.rgb, clamp(globals.pulse_intensity, 0.0, 1.0) * 0.5);
    return vec4<f32>(color * alpha * 2.0, alpha);
}
`
