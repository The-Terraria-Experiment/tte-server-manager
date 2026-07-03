/**
 * Helpers for deriving readable, on-brand chip styling from a role's stored
 * accent color (a raw CSS color string, or "" for "no color").
 */

let scratchCanvasCtx = null;

function resolveToRgb(color) {
	if (!color) return null;

	if (!scratchCanvasCtx) {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		scratchCanvasCtx = canvas.getContext('2d');
	}

	// fillStyle silently ignores invalid values, so compare before/after to detect a bad color string.
	scratchCanvasCtx.fillStyle = '#000000';
	scratchCanvasCtx.fillStyle = color;
	scratchCanvasCtx.fillRect(0, 0, 1, 1);
	const [r, g, b] = scratchCanvasCtx.getImageData(0, 0, 1, 1).data;
	return { r, g, b };
}

/**
 * Picks a readable text color class for a chip/background rendered with `color`.
 * Falls back to `light` when `color` is empty or unparsable.
 */
export function getContrastTextClass(color, { light = 'text-cream', dark = 'text-gray-1' } = {}) {
	const rgb = resolveToRgb(color);
	if (!rgb) return light;

	const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
	return luminance > 0.6 ? dark : light;
}
