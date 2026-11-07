import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from './main';

describe('App Component Integration Tests (Polish Round 3)', () => {
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

  it('renders script pane with rounds and model-generated lines without script nodes on canvas (S1)', () => {
    const { container } = render(<App />);
    expect(screen.getByText('GENERATED CODE')).toBeInTheDocument();
    expect(screen.getByText('ROUND 1')).toBeInTheDocument();
    expect(screen.getByText('ROUND 2')).toBeInTheDocument();
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
      screen.getByText(/total comes from payroll.get_salaries \(private\) and the tracker is public/),
    ).toBeInTheDocument();

    // Arguments and policy decision
    expect(screen.getByText('ARGUMENTS')).toBeInTheDocument();
    expect(screen.getByText(/Blocked · blocked: payroll total → public tracker/)).toBeInTheDocument();
    expect(screen.getByText('Not sent')).toBeInTheDocument();
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

    // Find and click the chip for total = 1,284,600
    const sourceChip = screen.getByTitle(/Inspect total = 1,284,600/);
    expect(sourceChip).toBeInTheDocument();
    fireEvent.click(sourceChip);

    // Now drawer should inspect value v4
    expect(screen.getByText(/INSPECTING VALUE/)).toBeInTheDocument();
    const drawer = container.querySelector('.drawer');
    expect(drawer).toHaveTextContent('1284600');
    expect(drawer).toHaveTextContent('private');
  });

  it('syncs script line clicks with graph node selection (S1)', () => {
    const { container } = render(<App />);
    // Line 1 code line button
    const line1Btn = screen.getByTitle('Line 1');
    fireEvent.click(line1Btn);

    // Selected state on line
    expect(line1Btn).toHaveClass('selected');
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

  it('toggles Legend popover to show edge and chip color guides', () => {
    render(<App />);
    const legendBtn = screen.getByText('Legend ▾');
    fireEvent.click(legendBtn);

    expect(screen.getByText('EDGES')).toBeInTheDocument();
    expect(screen.getByText('STATUS CHIPS')).toBeInTheDocument();
    expect(screen.getByText('Untrusted taint')).toBeInTheDocument();
  });

  it('toggles show every step mode (S1: intermediate values)', () => {
    render(<App />);
    const showEveryStepBtn = screen.getByText('Show every step');
    fireEvent.click(showEveryStepBtn);
    expect(screen.getByText('✓ Showing intermediate values')).toBeInTheDocument();
  });

  it('R1: Dims every node and edge not in the lineage when a node is selected', () => {
    const { container } = render(<App />);
    // Select blocked node c4 ("Post comment on #42")
    const blockedNode = Array.from(container.querySelectorAll('.node-card.chip-blocked'))[0];
    fireEvent.click(blockedNode);

    // Node c3 ("Send summary to HR") is not in c4 lineage -> must have dim class
    const hrNode = Array.from(container.querySelectorAll('.node-card')).find((el) =>
      el.textContent?.includes('Send summary to HR'),
    );
    expect(hrNode).toBeDefined();
    expect(hrNode).toHaveClass('dim');

    // Node c4 itself and its lineage (e.g. "total = 1,284,600 · line 4") must NOT have dim class
    expect(blockedNode).not.toHaveClass('dim');
    expect(blockedNode).toHaveClass('selected');

    const totalNode = Array.from(container.querySelectorAll('.node-card')).find((el) =>
      el.textContent?.includes('total = 1,284,600'),
    );
    expect(totalNode).toBeDefined();
    expect(totalNode).not.toHaveClass('dim');

    // Check SVG wires dimming: faded for non-lineage, lit for lineage
    const wires = Array.from(container.querySelectorAll('svg.wires g.wire'));
    expect(wires.some((w) => w.classList.contains('faded'))).toBe(true);
    expect(wires.some((w) => w.classList.contains('lit'))).toBe(true);
  });

  it('R2: Color-codes tags in strace view with status-chip classes', () => {
    const { container } = render(<App />);
    const straceTab = screen.getByText('strace');
    fireEvent.click(straceTab);

    const straceChips = container.querySelectorAll('.strace-row .strace-type');
    expect(straceChips.length).toBeGreaterThan(0);

    const chipClasses = Array.from(straceChips).map((el) => el.className);
    expect(chipClasses.some((c) => c.includes('chip-blocked'))).toBe(true);
    expect(chipClasses.some((c) => c.includes('chip-private'))).toBe(true);
    expect(chipClasses.some((c) => c.includes('status-chip'))).toBe(true);
  });

  it('L1 & L2: Positions nodes with left-to-right columns and renders orthogonal edge paths (S2)', () => {
    const { container } = render(<App />);
    const cards = Array.from(container.querySelectorAll('.node-card')) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(0);

    // Model turn 1 should be on the leftmost column (left = 180px)
    const m1Card = cards.find((c) => c.textContent?.includes('round 1') || c.textContent?.includes('writes code') || c.textContent?.includes('Gemini wrote a script'));
    expect(m1Card).toBeDefined();
    expect(m1Card?.style.left).toBe('180px');

    // Wires have orthogonal path commands (M, L, Q)
    const wirePaths = Array.from(container.querySelectorAll('svg.wires g.wire path'));
    expect(wirePaths.length).toBeGreaterThan(0);
    const dAttrs = wirePaths.map((p) => p.getAttribute('d') ?? '');
    expect(dAttrs.some((d) => d.includes('M') && d.includes('L'))).toBe(true);
  });

  it('L4: Handles Fit toggle with scaling', () => {
    render(<App />);
    const fitBtn = screen.getByTitle('Zoom graph to fit view');
    expect(fitBtn).toBeInTheDocument();
    fireEvent.click(fitBtn);
    expect(fitBtn).toHaveTextContent('100%');
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

  it('P1: Truncates scripts longer than 12 lines in Model Turn detail with show all lines toggle', () => {
    const { container } = render(<App />);

    // Switch to Run A which has model turns with scripts
    const runABtn = screen.getByText('Run A (4 Rounds)');
    fireEvent.click(runABtn);

    // Click on Model Turn 4 which has a 19-line script
    const modelNode = Array.from(container.querySelectorAll('.node-card')).find((el) =>
      el.textContent?.includes('round 4'),
    );
    expect(modelNode).toBeDefined();
    fireEvent.click(modelNode!);

    // Should render ScriptCodeBlock with show all lines button
    const showAllBtn = screen.getByText(/Show all 19 lines/);
    expect(showAllBtn).toBeInTheDocument();

    // Click to expand
    fireEvent.click(showAllBtn);
    expect(screen.getByText('Show fewer lines')).toBeInTheDocument();
  });
});
