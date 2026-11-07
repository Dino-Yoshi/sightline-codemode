import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App, computeLayout, NODE_WIDTH, NODE_HEIGHT } from './main';
import { parseRun, view } from './view';
import runAText from '../../runs/run-a.jsonl?raw';
import fakeRunText from '../../runs/fake-run.jsonl?raw';

describe('App Component Integration Tests (Polish Round 4)', () => {
  it('renders top bar, task, brand, replay controls, and prompt banner (S3)', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.brand')).toHaveTextContent('MCPVision');
    expect(screen.getByText('YOUR TASK')).toBeInTheDocument();
    expect(screen.getAllByText(/Triage this week's open issues/).length).toBeGreaterThan(0);
    expect(screen.getByText('Run replay')).toBeInTheDocument();

    // S3: Prompt banner above canvas
    const promptBanner = container.querySelector('.prompt-banner');
    expect(promptBanner).toBeInTheDocument();
    expect(promptBanner).toHaveTextContent(/You asked:/);
    expect(promptBanner).toHaveTextContent(/Triage this week's open issues and post the October payroll total to HR/);
  });

  it('H5: Renders script pane with Round N headers and model-generated lines without script nodes on canvas', () => {
    const { container } = render(<App />);
    expect(screen.getByText('GENERATED CODE')).toBeInTheDocument();
    const scriptPane = container.querySelector('.script-pane')!;
    expect(scriptPane).toBeInTheDocument();
    expect(scriptPane.textContent).toContain('Round 1');
    expect(scriptPane.textContent).toContain('Round 2');
    const scriptLines = container.querySelectorAll('.script-pane code');
    expect(scriptLines.length).toBeGreaterThan(0);
    expect(scriptLines[0]).toHaveTextContent('tracker.list_issues');

    // Canvas must NOT have any script line nodes
    const cards = Array.from(container.querySelectorAll('.node-card'));
    expect(cards.some((c) => c.classList.contains('kind-script'))).toBe(false);
  });

  it('renders active lane headers including plain descriptions and context tokens (S3: no YOU lane)', () => {
    render(<App />);
    // S3: YOU lane is removed
    expect(screen.queryByText('YOU')).not.toBeInTheDocument();
    expect(screen.getByText('MODEL')).toBeInTheDocument();
    expect(screen.getByText('SCRIPT')).toBeInTheDocument();
    expect(screen.getByText('TRACKER')).toBeInTheDocument();
    expect(screen.getByText('PAYROLL')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();

    expect(screen.getByText('Gemini: writes code, never calls tools')).toBeInTheDocument();
    expect(screen.getByText('the code it wrote, running in a sandbox')).toBeInTheDocument();
    expect(screen.getByText(/920 tok context/)).toBeInTheDocument();
    expect(screen.getByText(/15,060 sandbox tok/)).toBeInTheDocument();
  });

  it('renders Story drawer by default with headline verdict and context boundary', () => {
    render(<App />);
    expect(screen.getByText('RUN SUMMARY')).toBeInTheDocument();
    expect(screen.getByText('1 call blocked: private payroll data would have reached the public tracker')).toBeInTheDocument();
    expect(screen.getByText(/Gemini saw 920 tokens. 15,060 tokens stayed inside the sandbox./)).toBeInTheDocument();
  });

  it('S6: Shows call signature and blocked reason on blocked node card and opens detail drawer', () => {
    const { container } = render(<App />);
    const blockedNode = Array.from(container.querySelectorAll('.node-card.chip-blocked'))[0];
    expect(blockedNode).toBeDefined();

    // S6: Monospace call line and blocked reason on card
    expect(blockedNode.querySelector('.node-call-sig')).toHaveTextContent('tracker.post_comment');
    expect(blockedNode.querySelector('.node-blocked-reason')).toHaveTextContent('blocked: payroll total → public tracker');

    fireEvent.click(blockedNode);

    // Detail drawer opens
    expect(screen.getByText(/INSPECTING BLOCKED/)).toBeInTheDocument();
    expect(screen.getByText('This call was blocked before it was sent.')).toBeInTheDocument();
    expect(
      screen.getAllByText(/total comes from payroll.get_salaries \(private\) and the tracker is public/).length,
    ).toBeGreaterThan(0);

    // Arguments, Lineage, and policy decision (G5)
    expect(screen.getByText('ARGUMENTS')).toBeInTheDocument();
    expect(screen.getByText('LINEAGE')).toBeInTheDocument();
    expect(screen.getByText('POLICY')).toBeInTheDocument();
    expect(screen.getByText(/Blocked: private → public/)).toBeInTheDocument();
  });

  it('S7: Shows untrusted reason on UNTRUSTED node cards and explains why in detail drawer', () => {
    const { container } = render(<App />);
    const untrustedCard = Array.from(container.querySelectorAll('.node-card.chip-untrusted')).find((el) =>
      el.textContent?.includes('issues preview'),
    );
    expect(untrustedCard).toBeDefined();
    // Excerpt quoted on card
    expect(untrustedCard?.querySelector('.node-untrusted-reason')).toHaveTextContent(/Issue #42 hides an instruction/);

    fireEvent.click(untrustedCard!);
    expect(screen.getByText('UNTRUSTED DATA SOURCE')).toBeInTheDocument();
    expect(screen.getByText('HIDDEN INSTRUCTION DETECTED')).toBeInTheDocument();
  });

  it('navigates to source node when argument source chip is clicked', () => {
    const { container } = render(<App />);
    const blockedNode = Array.from(container.querySelectorAll('.node-card.chip-blocked'))[0];
    fireEvent.click(blockedNode);

    // Find and click the chip in ARGUMENTS section
    const sourceChip = container.querySelector('.arg-sources-chips .source-chip') as HTMLElement;
    expect(sourceChip).toBeInTheDocument();
    fireEvent.click(sourceChip);

    // Now drawer should inspect value
    expect(screen.getByText(/INSPECTING/)).toBeInTheDocument();
  });

  it('H6: Clicking a script line selects main node, scrolls canvas, and lights lineage; clicking again cycles', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollTo');
    const { container } = render(<App />);

    // Line 1 code line button
    const line1Btn = screen.getByTitle('Line 1');
    fireEvent.click(line1Btn);

    // Selected state on line
    expect(line1Btn).toHaveClass('selected');
    expect(scrollSpy).toHaveBeenCalled();

    // Clicking line 1 again cycles (if multiple nodes exist on line 1)
    fireEvent.click(line1Btn);
    expect(line1Btn).toHaveClass('selected');

    scrollSpy.mockRestore();
  });

  it('H6: Lines with no nodes (braces, return) are dimmer (no-node class) and do nothing on click', () => {
    const { container } = render(<App />);
    // Switch to Run A which has blank/braces lines
    const runABtn = screen.getByText('Recorded live: A (triage + HR)');
    fireEvent.click(runABtn);

    const noNodeLines = container.querySelectorAll('.code-line.no-node');
    expect(noNodeLines.length).toBeGreaterThan(0);

    // Clicking a no-node line does not select any node
    fireEvent.click(noNodeLines[0]);
    expect(container.querySelector('.drawer.story-drawer')).toBeInTheDocument();
  });

  it('toggles between Graph view and strace flat log view', () => {
    render(<App />);
    const straceTab = screen.getByText('strace');
    fireEvent.click(straceTab);

    expect(screen.getByText('Event log')).toBeInTheDocument();
    expect(screen.getAllByText('List open issues').length).toBeGreaterThan(0);

    const graphTab = screen.getByText('Graph');
    fireEvent.click(graphTab);
    expect(screen.getByText('Data Flow Graph')).toBeInTheDocument();
  });

  it('steps through replay using step ticks and replay buttons', () => {
    const { container } = render(<App />);
    const prevBtn = screen.getByLabelText('Previous step');
    const nextBtn = screen.getByLabelText('Next step');

    const stepLabel = container.querySelector('.step-label');
    expect(stepLabel).toHaveTextContent('STEP 09 / 09');

    // Click previous step
    fireEvent.click(prevBtn);
    expect(stepLabel).toHaveTextContent('STEP 08 / 09');

    // Click step tick 3
    const tick3 = screen.getByLabelText('Go to step 3');
    fireEvent.click(tick3);
    expect(stepLabel).toHaveTextContent('STEP 03 / 09');

    // Step 9 blocked node Post comment on #42 should be hidden now
    expect(screen.queryByText('Post comment on #42')).not.toBeInTheDocument();

    // Click next step
    fireEvent.click(nextBtn);
    expect(stepLabel).toHaveTextContent('STEP 04 / 09');
  });

  it('G2: Speed toggle cycles between 0.25x, 0.5x, 1x, and 2x; default 0.5x for live runs', () => {
    const { container } = render(<App />);
    const speedBtn = container.querySelector('.speed-btn')!;
    expect(speedBtn).toBeInTheDocument();
    expect(speedBtn).toHaveTextContent('1x');

    fireEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('2x');

    fireEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('0.25x');

    fireEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('0.5x');

    fireEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('1x');

    // Live run defaults speed to 0.5x
    const liveABtn = screen.getByText('Live A');
    fireEvent.click(liveABtn);
    expect(speedBtn).toHaveTextContent('0.5x');
  });

  it('G1a: Round header click collapses round into summary column and expands on second click', () => {
    const { container } = render(<App />);
    const round1Btn = screen.getByLabelText('Collapse Round 1');
    expect(round1Btn).toBeInTheDocument();

    // Collapse round 1
    fireEvent.click(round1Btn);
    expect(screen.getByLabelText('Round 1 collapsed. Click to expand.')).toBeInTheDocument();

    // Expand round 1 back
    const collapsedCol = screen.getByLabelText('Round 1 collapsed. Click to expand.');
    fireEvent.click(collapsedCol);
    expect(screen.getByLabelText('Collapse Round 1')).toBeInTheDocument();
  });

  it('G1b: Minimap renders in canvas corner with viewport indicator', () => {
    const { container } = render(<App />);
    const minimap = container.querySelector('.minimap');
    expect(minimap).toBeInTheDocument();
    expect(minimap?.querySelector('.minimap-viewport')).toBeInTheDocument();
  });

  it('G6: Honest labels for simulated run and banner', () => {
    const { container } = render(<App />);
    expect(screen.getAllByText('Simulated: injection succeeds').length).toBeGreaterThan(0);
    expect(screen.getByText('Recorded live: A (triage + HR)')).toBeInTheDocument();
    expect(screen.getByText('Recorded live: B (honest mistake)')).toBeInTheDocument();

    // Banner is visible for simulated run
    expect(
      screen.getByText(/Simulated run: shows what happens if the hidden instruction in issue #42 works/),
    ).toBeInTheDocument();
  });

  it('G3: Arrow keys follow and highlight revealed script line', () => {
    const { container } = render(<App />);
    // Press ArrowLeft to step back
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    const stepLabel = container.querySelector('.step-label');
    expect(stepLabel).toHaveTextContent('STEP 08 / 09');

    // Revealed line is highlighted
    const revealedLine = container.querySelector('.code-line.revealed');
    expect(revealedLine).toBeInTheDocument();
  });

  it('H5: Left script pane width can be dragged using resize handle', () => {
    const { container } = render(<App />);
    const resizer = container.querySelector('.pane-resizer-left')!;
    expect(resizer).toBeInTheDocument();

    // Trigger pointer events on resizer
    fireEvent.pointerDown(resizer, { clientX: 320 });
    fireEvent(window, new MouseEvent('pointermove', { clientX: 400 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 400 }));

    const mainEl = container.querySelector('main')!;
    expect(mainEl.style.gridTemplateColumns).toContain('400px');
  });

  it('H2 & R1: Hovering a node brings its connected edges to full opacity (hovered class)', () => {
    const { container } = render(<App />);
    const cards = container.querySelectorAll('.node-card');
    expect(cards.length).toBeGreaterThan(0);

    // Hover over the first card
    fireEvent.mouseEnter(cards[0]);

    // Check that connected wires have hovered class
    const hoveredWires = container.querySelectorAll('svg.wires g.wire.hovered');
    expect(hoveredWires.length).toBeGreaterThan(0);

    // Mouse leave removes hovered class
    fireEvent.mouseLeave(cards[0]);
    const remainingHovered = container.querySelectorAll('svg.wires g.wire.hovered');
    expect(remainingHovered.length).toBe(0);
  });

  it('H2 Geometry test: for run-a.jsonl, no edge segment intersects a node rectangle it does not connect to', () => {
    const runAEvents = parseRun(runAText);
    const vRunA = view(runAEvents, { showEveryStep: true });
    const layout = computeLayout(vRunA);

    function doSegmentsIntersectRect(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
    ): boolean {
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      // Outside bounding box
      if (maxX <= rx + 0.1 || minX >= rx + rw - 0.1) return false;
      if (maxY <= ry + 0.1 || minY >= ry + rh - 0.1) return false;

      // Vertical segment at x1
      if (Math.abs(x1 - x2) < 0.1) {
        return x1 > rx + 0.1 && x1 < rx + rw - 0.1 && minY < ry + rh - 0.1 && maxY > ry + 0.1;
      }
      // Horizontal segment at y1
      if (Math.abs(y1 - y2) < 0.1) {
        return y1 > ry + 0.1 && y1 < ry + rh - 0.1 && minX < rx + rw - 0.1 && maxX > rx + 0.1;
      }

      return true;
    }

    for (const edge of vRunA.edges) {
      const edgeKey = `${edge.from}-${edge.to}-${edge.kind}`;
      const segments = layout.edgeSegments[edgeKey] ?? [];

      for (const seg of segments) {
        for (const node of vRunA.nodes) {
          if (node.id === edge.from || node.id === edge.to) continue;
          const nodePos = layout.pos[node.id];
          if (!nodePos) continue;

          const intersects = doSegmentsIntersectRect(
            seg.x1,
            seg.y1,
            seg.x2,
            seg.y2,
            nodePos.x,
            nodePos.y,
            NODE_WIDTH,
            NODE_HEIGHT,
          );

          expect(
            intersects,
            `Edge ${edgeKey} segment [(${seg.x1},${seg.y1}) -> (${seg.x2},${seg.y2})] must not intersect node ${node.id} at [${nodePos.x}, ${nodePos.y}]`,
          ).toBe(false);
        }
      }
    }
  });

  it('H3: Fit toggle scales graph height to fit container and enables horizontal scrolling', () => {
    const { container } = render(<App />);
    const fitBtn = screen.getByTitle('Zoom graph to fit view');
    expect(fitBtn).toBeInTheDocument();
    fireEvent.click(fitBtn);
    expect(fitBtn).toHaveTextContent('100%');

    // Follow in fit mode centers column horizontally
    const nextBtn = screen.getByLabelText('Next step');
    fireEvent.click(nextBtn);

    fireEvent.click(fitBtn);
    expect(fitBtn).toHaveTextContent('Fit');
  });

  it('S4: Programmatic smooth scrolls do not cancel auto-follow, only user interaction cancels it', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollTo');
    const { container } = render(<App />);

    // Step navigation triggers programmatic scroll
    const nextBtn = screen.getByLabelText('Next step');
    fireEvent.click(nextBtn);
    expect(scrollSpy).toHaveBeenCalled();

    // Auto-follow button should NOT appear because auto-follow remains true
    expect(screen.queryByTitle(/Resume following/)).not.toBeInTheDocument();

    // Wheel on canvas cancels autoFollow
    const canvasScroll = container.querySelector('.canvas-scroll')!;
    fireEvent.wheel(canvasScroll);

    // Now Follow button appears
    expect(screen.getByTitle(/Resume following/)).toBeInTheDocument();

    // Clicking Follow resumes it
    fireEvent.click(screen.getByTitle(/Resume following/));
    expect(screen.queryByTitle(/Resume following/)).not.toBeInTheDocument();

    // Keydown arrow cancels autoFollow
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTitle(/Resume following/)).toBeInTheDocument();

    scrollSpy.mockRestore();
  });

  it('S5 & F4: Collapse chevrons are in header rows and side panes collapse', () => {
    const { container } = render(<App />);

    // Focus toggle button exists and defaults to on
    const focusBtn = screen.getByTitle('Auto-collapse side panes during playback');
    expect(focusBtn).toHaveTextContent('✓ Focus on');

    // S5: Collapse script pane button is inside .pane-head-actions
    const collapseScriptBtn = screen.getByLabelText('Collapse Script Pane');
    expect(collapseScriptBtn.closest('.pane-head-actions')).toBeInTheDocument();
    fireEvent.click(collapseScriptBtn);

    // Script pane is now collapsed rail
    expect(container.querySelector('.script-pane.collapsed-rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand Script Pane')).toBeInTheDocument();

    // Expand again
    fireEvent.click(screen.getByLabelText('Expand Script Pane'));
    expect(container.querySelector('.script-pane:not(.collapsed-rail)')).toBeInTheDocument();

    // S5: Collapse story pane button is inside .drawer-head-actions
    const collapseStoryBtn = screen.getByLabelText('Collapse Story Pane');
    expect(collapseStoryBtn.closest('.drawer-head-actions')).toBeInTheDocument();
    fireEvent.click(collapseStoryBtn);
    expect(container.querySelector('.drawer.collapsed-rail')).toBeInTheDocument();
  });
});
