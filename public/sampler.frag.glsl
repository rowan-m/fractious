#version 300 es
precision highp float;

in vec2 texCoord;
out vec4 fragmentColor;

uniform sampler2D sampler;

    void main(void) {
      fragmentColor = texture(sampler, texCoord);
    }