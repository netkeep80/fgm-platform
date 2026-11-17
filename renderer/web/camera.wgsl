struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertex_main(@location(0) position: vec3f, @location(1) color: vec3f) -> Vertex {
  return Vertex(vec4f(position, 1.0), color);
}

@fragment
fn fragment_main(input: Vertex) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
