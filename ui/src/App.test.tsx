import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
