<template>
	<div 
		ref="wrapper" 
		class="bg-gray-2 cursor-crosshair" 
		@mouseenter="hovering = true"
		@mouseleave="mouseleave"
		@mousemove="hovered"
		@mousedown="startZoom"
		@mouseup="endZoom"
	>
		<canvas ref="canvas">Graph could not be rendered.</canvas>
	</div>
</template>

<script>

const pointDistance = (point1, point2) => Math.sqrt((point2.x - point1.x) ** 2 + (point2.y - point1.y) ** 2);

export default {
	mixins: [],
	components: {
		
	},
	props: {
		/**
		 * Array of points of shape { x: Number, y: Number, group?: Number, series?: String|Number }
		 *
		 * `group` is a *drawing* concern: each group is stroked as one continuous
		 * path, so a caller splits a group wherever the line should break (a gap in
		 * the data, for instance). `series` is a *styling* concern — which dataset
		 * the point belongs to, looked up in `seriesConfig`. They're separate
		 * because one series can span many groups: two lines that each break over
		 * the same three gaps are six groups but still only two colors.
		 *
		 * A point with no `series` falls back to its `group`, so a caller that only
		 * needs one line per style can keep using `group` alone.
		 */
		points: {
			type: Array,
			default: [],
			validator: val => val.every(pt => Object.hasOwn(pt, "x") && Object.hasOwn(pt, "y"))
		},
		/**
		 * Per-series overrides, keyed by a point's `series` (or `group`). Every field
		 * is optional and falls back to the matching top-level prop:
		 *
		 *   { color, lineWeight, pointWeight, hoverPointWeight, label }
		 *
		 * `label` is shown in the hover readout, which is the only way to tell two
		 * near-overlapping lines apart once the cursor is on one of them.
		 */
		seriesConfig: {
			type: Object,
			default: () => ({})
		},
		/**
		 * Two points describing the bounds of the graph, one for the min corner (BL) and one for the max corner (TR), in that order.
		 * Leave as null to auto-detect. 
		 */
		bounds: {
			type: [Array, null],
			default: null,
			validator: val => val === null || (val.every(pt => Object.hasOwn(pt, "x") && Object.hasOwn(pt, "y")) && val.length === 2)
		},
		pointWeight: {
			type: Number,
			default: 0,
		},
		hoverConfig: {
			type: Object,
			default: () => ({})
		},
		lineWeight: {
			type: Number,
			default: 2,
		},
		color: {
			type: String,
			default: "#479093"
		},
		background: {
			type: String,
			default: "hsl(0, 0%, 16%)"
		},
		linesColor: {
			type: String,
			default: "hsl(0, 0%, 24%)"
		},
		axesConfig: {
			type: Object,
			default: () => ({})
		},
		edgeBuffer: {
			type: Number,
			default: 40,
		},
	},
	data() {
		return {
			resizeWatcher: null,
			normalizedPoints: [],
			effectivePoints: [],
			// effectivePoints ordered by x, regardless of series or group. The hover
			// lookup bisects on x and so needs a monotonic array; effectivePoints is
			// the caller's own order, which with more than one series runs ascending,
			// resets, and ascends again.
			xSortedPoints: [],
			ctx: null,
			dim: { x: -1, y: -1 },
			lastRepaint: 0,
			pendingRepaintTimer: null,
			lastResizeObserved: null,
			repaintTick: 300,
			hovering: false,
			zoomStartPos: null,
			zoomEndPos: null,
			zoomRange: null,
			currentHoverPos: null,
			defaultAxesConfig: {
				yAxisMarkCount: 3,
				minXAxisMarkDistance: 100,
				bottomBuffer: 40,
				leftBuffer: 40,
				bottomWeight: 2,
				tickWeight: 1,
				color: "hsl(0, 0%, 52%)",
				xAxisTextStyle: "12px JetBrains Mono",
				xAxisFormat: (val) => val,
				yAxisFormat: (val) => val
			},
			defaultHoverConfig: {
				pointWeight: 2,
				pointCircle: 4,
				hoverDistance: 20
			},
			dataBounds: { xMin: -1, xMax: -1, yMin: -1, yMax: -1 },
			hoveredPoint: null,
		}
	},
	computed: {
		// todo:
		/**
		 * - display axes
		 * - display point values
		 */
		resolvedAxesConfig() {
			return {
				...this.defaultAxesConfig,
				...this.axesConfig
			};
		},
		resolvedHoverConfig() {
			return {
				...this.defaultHoverConfig,
				...this.hoverConfig
			};
		}
	},
	methods: {
		/**
		 * Resolves the drawing style for one raw point, falling back per-field to the
		 * top-level props. Keyed on `series` when present so several groups can share
		 * one style; `group` is the fallback key for callers whose groups already are
		 * their series.
		 */
		styleFor(rawPoint) {
			const key = rawPoint?.series ?? rawPoint?.group;
			const config = (key !== undefined && key !== null && this.seriesConfig[key]) || {};

			// The hover weight is what makes individual samples visible on mouseover;
			// a series can opt out of that by setting its own hoverPointWeight.
			const basePointWeight = config.pointWeight ?? this.pointWeight;
			const hoverPointWeight = config.hoverPointWeight ?? config.pointWeight ?? this.resolvedHoverConfig.pointWeight;

			return {
				color: config.color ?? this.color,
				lineWeight: config.lineWeight ?? this.lineWeight,
				pointWeight: this.hovering ? hoverPointWeight : basePointWeight,
				label: config.label ?? null,
			};
		},
		draw(recalcPoints = false) {
			if (recalcPoints) {
				this.getEffectivePoints();
			}

			this.ctx.clearRect(0, 0, this.dim.x, this.dim.y);

			const getGraphPt = (...args) => {
				const res = this.normalizedToPixel(...args);
				return [res.x, res.y];
			};

			// bottom axis
			this.ctx.strokeStyle = this.resolvedAxesConfig.color;
			this.ctx.lineWidth = this.resolvedAxesConfig.bottomWeight;
			this.ctx.beginPath();
			this.ctx.moveTo(this.edgeBuffer/2 + this.resolvedAxesConfig.leftBuffer, this.dim.y * (1 - (this.resolvedAxesConfig.bottomBuffer / this.dim.y)));
			this.ctx.lineTo(this.dim.x - this.edgeBuffer/2, this.dim.y * (1 - (this.resolvedAxesConfig.bottomBuffer / this.dim.y)));
			this.ctx.stroke();

			// x-axis labels
			this.ctx.fillStyle = this.resolvedAxesConfig.color;
			this.ctx.strokeStyle = this.resolvedAxesConfig.color;
			this.ctx.font = this.resolvedAxesConfig.xAxisTextStyle;
			this.ctx.font = this.resolvedAxesConfig.xAxisTextStyle;
			this.ctx.textAlign = 'center';
			this.ctx.textBaseline = 'middle';
			const xAxisLabelCount = Math.floor(this.dim.x / this.resolvedAxesConfig.minXAxisMarkDistance);
			const resolvedXAxisMarkDistance = this.dim.x / xAxisLabelCount;
			for (let i = 0; i < xAxisLabelCount; i++) {
				const markAtPercent = ((resolvedXAxisMarkDistance * i) + (0.5 * resolvedXAxisMarkDistance)) / this.dim.x;
				const markAtValue = markAtPercent * (this.dataBounds.xMax - this.dataBounds.xMin) + this.dataBounds.xMin;
				const label = this.resolvedAxesConfig.xAxisFormat(markAtValue);
				this.ctx.fillText(label, getGraphPt({ x: markAtPercent, y: 0 })[0], (1 - ((this.resolvedAxesConfig.bottomBuffer / 2) / this.dim.y)) * this.dim.y);
				this.ctx.beginPath();
				this.ctx.moveTo(getGraphPt({ x: markAtPercent, y: 0 })[0], this.dim.y * (1 - (this.resolvedAxesConfig.bottomBuffer / this.dim.y)));
				this.ctx.lineTo(getGraphPt({ x: markAtPercent, y: 0 })[0], this.dim.y * (1 - (this.resolvedAxesConfig.bottomBuffer / this.dim.y)) + this.resolvedAxesConfig.bottomBuffer / 6);
				this.ctx.stroke();
			}

			// vertical axis and labels
			const step = 1 / this.resolvedAxesConfig.yAxisMarkCount;
			this.ctx.lineWidth = this.resolvedAxesConfig.tickWeight;
			this.ctx.strokeStyle = this.resolvedAxesConfig.color;
			this.ctx.textAlign = 'right';
			for (let i = 1; i <= this.resolvedAxesConfig.yAxisMarkCount; i++) {
				const yPos = getGraphPt({ x: 0, y: step * i })[1];

				this.ctx.beginPath();
				this.ctx.moveTo(this.edgeBuffer/2 + this.resolvedAxesConfig.leftBuffer, yPos);
				this.ctx.lineTo(this.dim.x - this.edgeBuffer/2, yPos);
				this.ctx.stroke();

				const markAtPercent = step * i;
				const markAtValue = markAtPercent * (this.dataBounds.yMax - this.dataBounds.yMin) + this.dataBounds.yMin;
				const label = this.resolvedAxesConfig.yAxisFormat(markAtValue);
				this.ctx.fillText(label, this.edgeBuffer/4 + this.resolvedAxesConfig.leftBuffer, yPos);
			}
			
			// hover crosshairs
			this.ctx.strokeStyle = this.linesColor;
			this.ctx.lineWidth = this.lineWeight;
			this.ctx.textBaseline = 'middle';
			if (this.currentHoverPos && !this.zoomStartPos && !this.zoomEndPos) {
				const hovAtPt = getGraphPt(this.currentHoverPos, false);
				// horizontal
				this.ctx.beginPath();
				this.ctx.moveTo(0, hovAtPt[1]);
				this.ctx.lineTo(this.dim.x, hovAtPt[1]);
				this.ctx.stroke();
				// vertical
				this.ctx.beginPath();
				this.ctx.moveTo(hovAtPt[0], 0);
				this.ctx.lineTo(hovAtPt[0], this.dim.y);
				this.ctx.stroke();

				const valueLiteral = this.pixelToValue(this.normalizedToPixel(this.currentHoverPos, false));

				this.ctx.textAlign = 'center';
				const xLabel = this.resolvedAxesConfig.xAxisFormat(valueLiteral.x);
				const xTxtBox = this.ctx.measureText(xLabel);
				const xTxtWidth = xTxtBox.width;
				const xTxtHeight = xTxtBox.actualBoundingBoxAscent + xTxtBox.actualBoundingBoxDescent;
				const xLabelY = (1 - ((this.resolvedAxesConfig.bottomBuffer / 2) / this.dim.y)) * this.dim.y;

				const pad = 5;
				this.ctx.fillStyle = this.background;
				const xLabelRect = [hovAtPt[0] - xTxtWidth / 2 - pad, xLabelY - xTxtBox.actualBoundingBoxAscent - pad, xTxtWidth + pad * 2, xTxtHeight + pad * 2];
				this.ctx.fillRect(...xLabelRect);
				this.ctx.strokeStyle = this.color;
				this.ctx.strokeRect(...xLabelRect)
				this.ctx.fillStyle = "white";
				this.ctx.fillText(xLabel, hovAtPt[0], xLabelY);

				this.ctx.textAlign = 'right';
				const yLabel = this.resolvedAxesConfig.yAxisFormat(valueLiteral.y);
				const yTxtBox = this.ctx.measureText(yLabel);
				const yTxtWidth = yTxtBox.width;
				const yTxtHeight = yTxtBox.actualBoundingBoxAscent + yTxtBox.actualBoundingBoxDescent;
				const yLabelX = this.edgeBuffer/4 + this.resolvedAxesConfig.leftBuffer;

				this.ctx.fillStyle = this.background;
				const yLabelRect = [yLabelX - yTxtWidth - pad, hovAtPt[1] - yTxtBox.actualBoundingBoxAscent - pad, yTxtWidth + pad * 2, yTxtHeight + pad * 2];
				this.ctx.fillRect(...yLabelRect);
				this.ctx.strokeStyle = this.color;
				this.ctx.strokeRect(...yLabelRect)
				this.ctx.fillStyle = "white";
				this.ctx.fillText(yLabel, yLabelX, hovAtPt[1]);
			}

			// Data
			// Draw the connecting line(s), one path per group, stroked once each.
			// Style is resolved per group rather than once up front: groups are sorted
			// together but consecutive groups can belong to different series, and a
			// stroke uses whatever strokeStyle was set when it runs - so a single
			// assignment before the loop would paint every line the last series' color.
			let currentPtGroup = null;
			let pathStarted = false;
			this.normalizedPoints.forEach(pt => {
				if (pt.raw.group !== currentPtGroup) {
					if (pathStarted) {
						this.ctx.stroke();
					}
					currentPtGroup = pt.raw.group;
					const style = this.styleFor(pt.raw);
					this.ctx.strokeStyle = style.color;
					this.ctx.lineWidth = style.lineWeight;
					this.ctx.beginPath();
					this.ctx.moveTo(...getGraphPt(pt.position));
					pathStarted = true;
				} else {
					this.ctx.lineTo(...getGraphPt(pt.position));
				}
			});
			if (pathStarted) {
				this.ctx.stroke();
			}

			// Draw point markers as their own paths so they don't get folded into a line stroke.
			this.normalizedPoints.forEach(pt => {
				const style = this.styleFor(pt.raw);
				if (!style.pointWeight) {
					return;
				}
				this.ctx.fillStyle = style.color;
				this.ctx.beginPath();
				this.ctx.arc(...getGraphPt(pt.position), style.pointWeight, 0, 2 * Math.PI);
				this.ctx.fill();
			});

			if (this.hoveredPoint) {
				const hoveredStyle = this.styleFor(this.hoveredPoint);
				const normalizedHovPt = this.valueToNormalized(this.hoveredPoint);
				const hovPixelPt = getGraphPt(normalizedHovPt);
				// The ring and the label border take the hovered series' own color:
				// with two near-overlapping lines, which one the readout describes is
				// otherwise a guess.
				this.ctx.strokeStyle = hoveredStyle.color;
				this.ctx.lineWidth = this.lineWeight;
				this.ctx.beginPath();
				this.ctx.arc(...hovPixelPt, this.resolvedHoverConfig.pointCircle, 0, 2 * Math.PI);
				this.ctx.stroke();

				// x: pixel-x grows the same direction as normalized x, so this flips cleanly.
				// y: normalized y is bottom-up but pixel y is top-down, so the branches invert
				// relative to x - without this, the box gets pushed away from canvas center
				// vertically instead of toward it.
				const direction = { x: normalizedHovPt.x > 0.5 ? -1 : 1, y: normalizedHovPt.y > 0.5 ? 1 : -1 };
				const xLabel = this.resolvedAxesConfig.xAxisFormat(this.hoveredPoint.x);
				const yLabel = this.resolvedAxesConfig.yAxisFormat(this.hoveredPoint.y);
				const fullLabel = hoveredStyle.label
					? `${hoveredStyle.label} · ${xLabel} | ${yLabel}`
					: `${xLabel} | ${yLabel}`;
				this.ctx.textAlign = 'center';

				const labelTextBox = this.ctx.measureText(fullLabel);
				const tbWidth = labelTextBox.width;
				const tbHeight = labelTextBox.actualBoundingBoxAscent + labelTextBox.actualBoundingBoxDescent;
				// const xLabelY = (1 - ((this.resolvedAxesConfig.bottomBuffer / 2) / this.dim.y)) * this.dim.y;

				const pad = 5;
				this.ctx.fillStyle = this.background;
				// fillRect/strokeRect take a top-left corner, not a center, so anchor the box's
				// near corner just outside the hover circle and let it grow away from the point,
				// toward canvas center, rather than centering it on the point.
				const boxWidth = tbWidth + pad * 2;
				const boxHeight = tbHeight + pad * 2;
				const gap = this.resolvedHoverConfig.pointCircle + pad;
				const labelRect = [
					direction.x === 1 ? hovPixelPt[0] + gap : hovPixelPt[0] - gap - boxWidth,
					direction.y === 1 ? hovPixelPt[1] + gap : hovPixelPt[1] - gap - boxHeight,
					boxWidth,
					boxHeight
				];

				this.ctx.fillRect(...labelRect);
				this.ctx.strokeStyle = hoveredStyle.color;
				this.ctx.strokeRect(...labelRect)
				this.ctx.fillStyle = "white";
				// textAlign is 'center' and textBaseline is 'middle' (set above), so the box's
				// own center is the correct anchor point regardless of which corner it grew from.
				this.ctx.fillText(fullLabel, labelRect[0] + boxWidth / 2, labelRect[1] + boxHeight / 2);
			}

			// zoom box
			// lineWidth is restated because the data loop above leaves whatever the
			// last series set; the box is chrome, not a series.
			this.ctx.strokeStyle = this.linesColor;
			this.ctx.lineWidth = this.lineWeight;
			if (this.zoomStartPos && !this.zoomEndPos) {
				const zoomNorm = this.zoomStartPos.x / this.dim.x

				const box = [
					getGraphPt({ x: zoomNorm, y: 0 }, false),
					getGraphPt({ x: zoomNorm, y: 1 }, false),
					getGraphPt({ x: this.currentHoverPos.x, y: 0 }, false),
					getGraphPt({ x: this.currentHoverPos.x, y: 1 }, false)
				];

				this.ctx.globalAlpha = 0.3;
				this.ctx.fillStyle = this.color;
				this.ctx.fillRect(box[0][0], 0, box[2][0] - box[0][0], this.dim.y);
				this.ctx.globalAlpha = 1;

				// start bound border
				this.ctx.beginPath();
				this.ctx.moveTo(...box[0]);
				this.ctx.lineTo(...box[1]);
				this.ctx.stroke();
				// end bound border
				this.ctx.beginPath();
				this.ctx.moveTo(...box[2]);
				this.ctx.lineTo(...box[3]);
				this.ctx.stroke();
			}
		},
		normalizePoints(points) {
			const normalizedPoints = [];

			let xMin, xMax, yMin, yMax, xRange, yRange;
			if (this.bounds === null) {
				xMin = this.effectivePoints.reduce((val, point) => Math.min(val, point.x), Number.POSITIVE_INFINITY);
				xMax = this.effectivePoints.reduce((val, point) => Math.max(val, point.x), Number.NEGATIVE_INFINITY);
				yMin = this.effectivePoints.reduce((val, point) => Math.min(val, point.y), Number.POSITIVE_INFINITY);
				yMax = this.effectivePoints.reduce((val, point) => Math.max(val, point.y), Number.NEGATIVE_INFINITY);
			} else {
				xMin = this.bounds[0].x;
				xMax = this.bounds[1].x;
				yMin = this.bounds[0].y;
				yMax = this.bounds[1].y;
			}

			this.dataBounds = { xMin, xMax, yMin, yMax };

			xRange = xMax - xMin;
			yRange = yMax - yMin;

			this.effectivePoints.forEach(point => {
				normalizedPoints.push({
					position: this.valueToNormalized(point),
					raw: point
				});
			});

			normalizedPoints.sort((a, b) => {
				if (a.raw.group !== undefined && b.raw.group !== undefined) {
					if (a.raw.group === b.raw.group) {
						return a.position.x !== b.position.x ? a.position.x - b.position.x : a.position.y - b.position.y
					} else {
						return a.raw.group - b.raw.group; // doesn't really matter what order these are in, just that they are grouped
					}
				} else if (a.raw.group === undefined && b.raw.group === undefined) {
					return a.position.x !== b.position.x ? a.position.x - b.position.x : a.position.y - b.position.y
				} else {
					return (a.raw.group || -1) - (b.raw.group || -1);
				}
			});

			return normalizedPoints;
		},
		getEffectivePoints() {
			if (!this.zoomRange) {
				this.effectivePoints = this.points;
			} else {
				const zoomedPoints = this.normalizePoints(this.points).filter(pt => pt.position.x >= this.zoomRange[0] && pt.position.x <= this.zoomRange[1]).map(pt => pt.raw);
				if (zoomedPoints.length < 2) {
					this.zoomStartPos = null;
					this.zoomEndPos = null;
					return;
				} else {
					this.effectivePoints = zoomedPoints;
				}
			}

			this.normalizedPoints = this.normalizePoints(this.effectivePoints);
			this.xSortedPoints = [...this.effectivePoints].sort((a, b) => a.x - b.x);
		},
		handleResize(entries) {
			if (!entries.length) {
				return;
			}
			this.lastResizeObserved = entries;

			// Throttle with a trailing edge: repaint immediately if we're outside the
			// cooldown window, otherwise schedule exactly one trailing repaint using
			// whatever the latest observed entries turn out to be. Once that trailing
			// repaint fires, nothing reschedules another one unless a new resize comes in.
			const elapsed = Date.now() - this.lastRepaint;
			if (elapsed >= this.repaintTick) {
				this.repaint();
			} else if (!this.pendingRepaintTimer) {
				this.pendingRepaintTimer = setTimeout(() => {
					this.pendingRepaintTimer = null;
					this.repaint();
				}, this.repaintTick - elapsed);
			}
		},
		repaint() {
			const entries = this.lastResizeObserved;
			this.lastRepaint = Date.now();

			if (entries && entries[0]) {
				this.$refs.canvas.width = this.dim.x = entries[0].contentRect.width;
				this.$refs.canvas.height = this.dim.y = entries[0].contentRect.height;
			}

			this.draw(true);
		},
		startZoom(event) {
			const rect = this.$refs.canvas.getBoundingClientRect();
			this.zoomStartPos = {
				x: event.clientX - rect.x,
				y: event.clientY - rect.y
			};
		},
		// Inverse of getGraphPt (withBuffers = true): converts a raw canvas-pixel point
		// into the same 0-1 data-normalized space that normalizedPoints/pt.position use.
		// Points are drawn inset by the edge/left/bottom axis buffers rather than
		// stretched edge-to-edge, so a plain pixel/dim division doesn't line up with
		// what's visually under the cursor - this does. Callers that only need one axis
		// can just discard the other.
		pixelToNormalized(pixelPos) {
			const buffer = this.edgeBuffer;
			const leftBuffer = this.resolvedAxesConfig.leftBuffer;
			const bottomBuffer = this.resolvedAxesConfig.bottomBuffer;

			const usableWidth = (this.dim.x - leftBuffer) - buffer;
			const normX = (pixelPos.x - buffer / 2 - leftBuffer) / usableWidth;

			const usableHeight = (this.dim.y - bottomBuffer) - buffer / 2;
			const normY = 1 - (pixelPos.y - buffer / 2) / usableHeight;

			return {
				x: Math.min(1, Math.max(0, normX)),
				y: Math.min(1, Math.max(0, normY))
			};
		},
		// A series can legitimately be constant on one axis - an idle instance
		// reports 0% CPU for every sample in the window - which makes the range
		// zero and every normalized value NaN, so nothing draws at all. Centering
		// that axis instead renders the flat line the data actually describes.
		normalizeAgainst(value, min, max) {
			const range = max - min;
			return range === 0 ? 0.5 : (value - min) / range;
		},
		valueToNormalized(pos) {
			return {
				x: this.normalizeAgainst(pos.x, this.dataBounds.xMin, this.dataBounds.xMax),
				y: this.normalizeAgainst(pos.y, this.dataBounds.yMin, this.dataBounds.yMax)
			}
		},
		normalizedToValue(pos) {
			return {
				x: pos.x * (this.dataBounds.xMax - this.dataBounds.xMin) + this.dataBounds.xMin,
				y: pos.y * (this.dataBounds.yMax - this.dataBounds.yMin) + this.dataBounds.yMin
			}
		},
		normalizedToPixel(pos, withBuffers = true) {
			const buffer = withBuffers ? this.edgeBuffer : 0;
			const effectiveY = withBuffers ? this.dim.y - this.resolvedAxesConfig.bottomBuffer : this.dim.y;
			const effectiveX = withBuffers ? this.dim.x - this.resolvedAxesConfig.leftBuffer : this.dim.x;
			const leftBuffer = withBuffers ? this.resolvedAxesConfig.leftBuffer : 0;

			return {
				x: pos.x * (effectiveX - buffer) + buffer / 2 + leftBuffer,
				y: (1 - pos.y) * (effectiveY - buffer / 2) + buffer / 2
			};
		},
		valueToPixel(pos) {
			return this.normalizedToPixel(this.valueToNormalized(pos));
		},
		pixelToValue(pos) {
			return this.normalizedToValue(this.pixelToNormalized(pos));
		},
		endZoom(event) {
			const rect = this.$refs.canvas.getBoundingClientRect();
			this.zoomEndPos = {
				x: event.clientX - rect.x,
				y: event.clientY - rect.y
			};

			const distance = pointDistance(this.zoomEndPos, this.zoomStartPos);
			if (distance < 5) {
				this.zoomStartPos = null;
				this.zoomEndPos = null;
				this.zoomRange = null;
				this.draw(true);
			} else {
				this.zoomRange = [
					this.pixelToNormalized(this.zoomStartPos).x,
					this.pixelToNormalized(this.zoomEndPos).x
				].sort();
				this.zoomStartPos = null;
				this.zoomEndPos = null;
				this.draw(true);
			}
		},
		hovered(event) {
			const rect = this.$refs.canvas.getBoundingClientRect();
			this.currentHoverPos = {
				x: (event.clientX - rect.x) / this.dim.x,
				y: (1 - (event.clientY - rect.y) / this.dim.y)
			};
			this.draw();
			this.hoveredPoint = this.findClosePoint({ x: event.clientX - rect.x, y: event.clientY - rect.y });
		},
		mouseleave(event) {
			this.hovering = false;
			this.currentHoverPos = null;
			this.hoveredPoint = null;
		},
		/**
		 * The point nearest the cursor within `hoverConfig.hoverDistance`, or null.
		 *
		 * Bisects to the cursor's x and then scans outward, rather than reporting
		 * whichever point a fixed number of bisection probes happened to land on.
		 * The probe-only version could only ever return one of ~log2(n) candidates,
		 * so with two series sharing an x it had no way to pick the nearer of the
		 * two - and it read the caller's own array order as if it were sorted by x,
		 * which stops being true the moment there is more than one series.
		 */
		findClosePoint(pos) {
			const points = this.xSortedPoints;
			if (!points.length) {
				return null;
			}

			const realAtValue = this.normalizedToValue(this.pixelToNormalized(pos));

			let low = 0;
			let high = points.length;
			while (low < high) {
				const mid = (low + high) >> 1;
				if (points[mid].x < realAtValue.x) {
					low = mid + 1;
				} else {
					high = mid;
				}
			}

			const closestPoint = {
				point: null,
				dist: Number.MAX_SAFE_INTEGER
			};

			// Returns false once the scan has walked past the hover radius on x alone,
			// which bounds each direction: every point further out is at least that
			// far away.
			const consider = index => {
				const point = points[index];
				if (!point) {
					return false;
				}

				const pixel = this.valueToPixel(point);
				if (Math.abs(pixel.x - pos.x) > this.resolvedHoverConfig.hoverDistance) {
					return false;
				}

				const dist = pointDistance(pos, pixel);
				if (dist < this.resolvedHoverConfig.hoverDistance && dist < closestPoint.dist) {
					closestPoint.point = point;
					closestPoint.dist = dist;
				}

				return true;
			};

			for (let i = low; i < points.length && consider(i); i++);
			for (let i = low - 1; i >= 0 && consider(i); i--);

			return closestPoint.point;
		}
	},
	mounted() {
		if (!this.resizeWatcher) {
			this.resizeWatcher = new ResizeObserver(this.handleResize);
			this.resizeWatcher.observe(this.$refs.wrapper);
		}
		if (!this.ctx) {
			this.ctx = this.$refs.canvas.getContext("2d");
		}
		this.draw(true);
	},
	unmounted() {
		this.resizeWatcher?.disconnect();
		this.resizeWatcher = null;

		if (this.pendingRepaintTimer) {
			clearTimeout(this.pendingRepaintTimer);
			this.pendingRepaintTimer = null;
		}
	},
	watch: {
		points() {
			this.draw(true);
		},
		hovering() {
			this.draw();
		},
		lineWeight() {
			this.draw();
		},
		seriesConfig() {
			this.draw();
		}
	}
}
</script>

<style scoped>

</style>
