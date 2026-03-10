import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../wasm/pkg/fractious_lib.js', () => ({
    default: vi.fn(),
    add_coord: vi.fn(),
    init_hooks: vi.fn(),
    sub_coord: vi.fn()
}));

const mockDocument = {
    getElementById: vi.fn(() => ({})),
    activeElement: {},
    body: {}
};
vi.stubGlobal('document', mockDocument);

const { Fractious, createDefaultConfig, createDefaultState } = await import('./main.js');

describe('parseURL', () => {
    let app;
    let config;
    let state;
    let mockRenderer;
    let mockWorkerManager;
    let mockInteractionManager;

    beforeEach(() => {
        config = createDefaultConfig();
        state = createDefaultState();
        mockRenderer = { init: vi.fn(), render: vi.fn(), updateOrbitBuffer: vi.fn(), onSubmittedWorkDone: vi.fn() };
        mockWorkerManager = { init: vi.fn(), updateReference: vi.fn() };
        mockInteractionManager = { bindEvents: vi.fn(), updateUI: vi.fn(), el: { canvas: { clientWidth: 800, clientHeight: 600 } } };

        app = new Fractious(config, state, mockRenderer, mockWorkerManager, mockInteractionManager);
    });

    it('should parse URL parameters and update config appropriately', () => {
        vi.stubGlobal('window', {
            location: { search: '?x=1.5&y=-0.5&z=2&r=3.14&h=0.5&s=0.1' },
            devicePixelRatio: 1
        });

        app.parseURL();

        expect(app.config.centerX).toBe('1.5');
        expect(app.config.centerY).toBe('-0.5');
        expect(app.state.refX).toBe('1.5');
        expect(app.state.refY).toBe('-0.5');
        expect(app.config.zoom).toBeCloseTo(0.01);
        expect(app.state.targetZoom).toBeCloseTo(0.01);
        expect(app.config.rotation).toBeCloseTo(3.14);
        expect(app.config.hue).toBeCloseTo(0.5);
        expect(app.config.hueStep).toBeCloseTo(0.1);

        expect(app.config.iter).toBe(2400);
    });

    it('should handle missing URL parameters gracefully', () => {
        vi.stubGlobal('window', {
            location: { search: '' },
            devicePixelRatio: 1
        });

        const initialConfig = { ...app.config };

        app.parseURL();

        expect(app.config.centerX).toBe(initialConfig.centerX);
        expect(app.config.centerY).toBe(initialConfig.centerY);
        expect(app.config.zoom).toBe(initialConfig.zoom);
        expect(app.config.rotation).toBe(initialConfig.rotation);
        expect(app.config.hue).toBe(initialConfig.hue);
        expect(app.config.hueStep).toBe(initialConfig.hueStep);
    });

    it('should ignore invalid numeric values', () => {
        vi.stubGlobal('window', {
            location: { search: '?z=abc&r=def&h=ghi&s=jkl' },
            devicePixelRatio: 1
        });

        const initialConfig = { ...app.config };

        app.parseURL();

        expect(app.config.zoom).toBe(initialConfig.zoom);
        expect(app.config.rotation).toBe(initialConfig.rotation);
        expect(app.config.hue).toBe(initialConfig.hue);
        expect(app.config.hueStep).toBe(initialConfig.hueStep);
    });
});
