import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionManager } from './InteractionManager.js';

vi.mock('../wasm/pkg/fractious_lib.js', () => ({
    add_coord: vi.fn(),
    sub_coord: vi.fn(),
}));

describe('InteractionManager updateUI', () => {
    let interactionManager;
    let config;
    let state;
    let elements;
    let callbacks;

    beforeEach(() => {
        config = {
            centerX: "1.5",
            centerY: "-0.5",
            zoom: 0.01,
            rotation: Math.PI / 4, // 45 degrees
            iter: 100,
            hue: 0.5,
            hueStep: 0.1
        };
        state = {};

        elements = {
            inputs: {
                c_re: { value: '' },
                c_im: { value: '' },
                zoom: { value: '' },
                rotation: { value: '' },
                iterations: { value: '' },
                hue: { value: '' },
                hueStep: { value: '' }
            }
        };

        callbacks = {
            onInteract: vi.fn(),
            onRequestRender: vi.fn(),
            onResize: vi.fn(),
        };

        // Stub document to simulate active element
        vi.stubGlobal('document', { activeElement: null });

        interactionManager = new InteractionManager(elements, config, state, callbacks);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should update UI input values from config when not active', () => {
        interactionManager.updateUI();

        expect(elements.inputs.c_re.value).toBe("1.5");
        expect(elements.inputs.c_im.value).toBe("-0.5");
        expect(elements.inputs.zoom.value).toBe("2.00"); // -Math.log10(0.01) = 2.00
        expect(elements.inputs.rotation.value).toBe("45.0");
        expect(elements.inputs.iterations.value).toBe(100);
        expect(elements.inputs.hue.value).toBe("0.500");
        expect(elements.inputs.hueStep.value).toBe("0.100");
    });

    it('should not update UI input value if it is the active element', () => {
        // Make c_re the active element
        vi.stubGlobal('document', { activeElement: elements.inputs.c_re });
        elements.inputs.c_re.value = "user_typing";

        interactionManager.updateUI();

        expect(elements.inputs.c_re.value).toBe("user_typing");
        // Other elements should still update
        expect(elements.inputs.c_im.value).toBe("-0.5");
    });

    it('should set input value even if current value is loosely equal but strictly different', () => {
        elements.inputs.c_re.value = "1.50000"; // different string representation

        interactionManager.updateUI();

        expect(elements.inputs.c_re.value).toBe("1.5");
    });
});
