import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from './main';

describe('App Component Integration Tests', () => {
  it('renders top bar, task, brand, and replay controls', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.brand')).toHaveTextContent('MCPVision');
    expect(screen.getByText('YOUR TASK')).toBeInTheDocument();
    expect(screen.getAllByText(/Triage this week's open issues/).length).toBeGreaterThan(0);
    expect(screen.getByText('Run replay')).toBeInTheDocument();
  });

  it('renders script pane with rounds and model-generated lines', () => {
    const { container } = render(<App />);
    expect(screen.getByText('GENERATED CODE')).toBeInTheDocument();
    expect(screen.getByText('ROUND 1')).toBeInTheDocument();
    expect(screen.getByText('ROUND 2')).toBeInTheDocument();
    const scriptLines = container.querySelectorAll('.script-pane code');
    expect(scriptLines.length).toBeGreaterThan(0);
    expect(scriptLines[0]).toHaveTextContent('tracker.list_issues');
  });

  it('renders all lane headers including plain descriptions and context tokens', () => {
    render(<App />);
    expect(screen.getByText('YOU')).toBeInTheDocument();
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

  it('opens detail drawer with policy reason when blocked node is selected', () => {
    const { container } = render(<App />);
    const blockedNode = Array.from(container.querySelectorAll('.node-card.chip-blocked'))[0];
    expect(blockedNode).toBeDefined();
    fireEvent.click(blockedNode);

    // Detail drawer opens
    expect(screen.getByText(/INSPECTING BLOCKED/)).toBeInTheDocument();
    expect(screen.getByText('This call was blocked before it was sent.')).toBeInTheDocument();
    expect(
      screen.getByText(/total comes from payroll.get_salaries \(private\) and the tracker is public/),
    ).toBeInTheDocument();

    // Arguments and policy decision
    expect(screen.getByText('ARGUMENTS')).toBeInTheDocument();
    expect(screen.getByText(/Blocked · private→public/)).toBeInTheDocument();
    expect(screen.getByText('Not sent')).toBeInTheDocument();
  });

  it('navigates to source node when argument source chip is clicked', () => {
    const { container } = render(<App />);
    const blockedNode = Array.from(container.querySelectorAll('.node-card.chip-blocked'))[0];
    fireEvent.click(blockedNode);

    // Find and click the chip for Sum the gross pay
    const sourceChip = screen.getByTitle('Inspect Sum the gross pay');
    expect(sourceChip).toBeInTheDocument();
    fireEvent.click(sourceChip);

    // Now drawer should inspect value v4
    expect(screen.getByText(/INSPECTING VALUE/)).toBeInTheDocument();
    const drawer = container.querySelector('.drawer');
    expect(drawer).toHaveTextContent('1284600');
    expect(drawer).toHaveTextContent('private');
  });

  it('syncs script line clicks with graph node selection', () => {
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

  it('toggles show every step mode', () => {
    render(<App />);
    const showEveryStepBtn = screen.getByText('Show every step');
    fireEvent.click(showEveryStepBtn);
    expect(screen.getByText('✓ Showing every step')).toBeInTheDocument();
  });

  // --- POLISH ROUND 2 SPEC TESTS ---

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

    // Node c4 itself and its lineage (e.g. "Sum the gross pay") must NOT have dim class
    expect(blockedNode).not.toHaveClass('dim');
    expect(blockedNode).toHaveClass('selected');

    const sumNode = Array.from(container.querySelectorAll('.node-card')).find((el) =>
      el.textContent?.includes('Sum the gross pay'),
    );
    expect(sumNode).toBeDefined();
    expect(sumNode).not.toHaveClass('dim');

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

    // Check that chip classes like chip-blocked, chip-private, chip-untrusted are applied
    const chipClasses = Array.from(straceChips).map((el) => el.className);
    expect(chipClasses.some((c) => c.includes('chip-blocked'))).toBe(true);
    expect(chipClasses.some((c) => c.includes('chip-private'))).toBe(true);
    expect(chipClasses.some((c) => c.includes('status-chip'))).toBe(true);
  });

  it('L1 & L2: Positions nodes with left-to-right columns and renders orthogonal edge paths', () => {
    const { container } = render(<App />);
    const cards = Array.from(container.querySelectorAll('.node-card')) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(0);

    // Prompt node should be on the leftmost column (left = 170px)
    const promptCard = cards.find((c) => c.textContent?.includes('You asked'));
    expect(promptCard).toBeDefined();
    expect(promptCard?.style.left).toBe('170px');

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

  it('F1: Smoothly centers newest node on auto-follow during replay', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollTo');
    const { container } = render(<App />);

    // Click next step
    const nextBtn = screen.getByLabelText('Next step');
    fireEvent.click(nextBtn);

    // scrollTo should be invoked by autoFollow
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('F4: Allows collapsing both side panes manually and toggles Focus mode', () => {
    const { container } = render(<App />);

    // Focus toggle button exists and defaults to on
    const focusBtn = screen.getByTitle('Auto-collapse side panes during playback');
    expect(focusBtn).toHaveTextContent('✓ Focus on');

    // Collapse left script pane manually
    const collapseScriptBtn = screen.getByLabelText('Collapse Script Pane');
    fireEvent.click(collapseScriptBtn);

    // Script pane should now be a 28px rail
    expect(container.querySelector('.script-pane.collapsed-rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand Script Pane')).toBeInTheDocument();

    // Expand script pane again
    fireEvent.click(screen.getByLabelText('Expand Script Pane'));
    expect(container.querySelector('.script-pane:not(.collapsed-rail)')).toBeInTheDocument();

    // Collapse right detail/story drawer manually
    const collapseStoryBtn = screen.getByLabelText('Collapse Story Pane');
    fireEvent.click(collapseStoryBtn);
    expect(container.querySelector('.drawer.collapsed-rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Expand Details Pane')).toBeInTheDocument();
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

  it('P2: Displays actual prompt text on YOU node, Story sentence 1, and clamped in YOU lane header', () => {
    const { container } = render(<App />);

    // YOU node card shows "You asked" and prompt text
    const youNode = Array.from(container.querySelectorAll('.node-card')).find((el) =>
      el.textContent?.includes('You asked'),
    );
    expect(youNode).toBeDefined();
    expect(youNode?.textContent).toContain("Triage this week's open issues");

    // Story sentence 1 shows "1. You asked: ..."
    expect(screen.getByText(/1\. You asked: "Triage this week's open issues/)).toBeInTheDocument();

    // YOU lane subtitle in header is clamped and has tooltip
    const youLaneDesc = container.querySelector('.lane-desc.clamp-2');
    expect(youLaneDesc).toBeDefined();
    expect(youLaneDesc).toHaveAttribute('title');
    expect(youLaneDesc?.getAttribute('title')).toContain("Triage this week's open issues");
  });
});
