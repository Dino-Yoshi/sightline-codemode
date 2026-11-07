import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './main';

describe('App Component Integration Tests', () => {
  it('renders top bar, task, brand, and replay controls', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.brand')).toHaveTextContent('MCPVision');
    expect(screen.getByText('YOUR TASK')).toBeInTheDocument();
    expect(screen.getByText(/Triage this week's open issues/)).toBeInTheDocument();
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

  it('renders all lane headers including context boundary indicators', () => {
    render(<App />);
    expect(screen.getByText('YOU')).toBeInTheDocument();
    expect(screen.getByText('MODEL')).toBeInTheDocument();
    expect(screen.getByText('SCRIPT')).toBeInTheDocument();
    expect(screen.getByText('TRACKER')).toBeInTheDocument();
    expect(screen.getByText('PAYROLL')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();

    expect(screen.getByText('CONTEXT BOUNDARY')).toBeInTheDocument();
    expect(screen.getByText(/sandbox-only tokens/)).toBeInTheDocument();
  });

  it('opens detail drawer with policy reason when blocked node is selected', () => {
    const { container } = render(<App />);
    const blockedNode = Array.from(container.querySelectorAll('.node-card.blocked'))[0];
    expect(blockedNode).toBeDefined();
    fireEvent.click(blockedNode);

    // Detail drawer opens
    expect(screen.getByText(/INSPECTING BLOCKED/)).toBeInTheDocument();
    expect(screen.getByText('Blocked before it was sent')).toBeInTheDocument();
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
    const blockedNode = Array.from(container.querySelectorAll('.node-card.blocked'))[0];
    fireEvent.click(blockedNode);

    // Find and click the chip for Value (reduce)
    const sourceChip = screen.getByTitle('Inspect Value (reduce)');
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
    // Line 3: payroll.get_salaries
    const line3Btn = screen.getByTitle('Select line 3');
    fireEvent.click(line3Btn);

    // Should inspect script line 3
    expect(screen.getByText(/INSPECTING SCRIPT/)).toBeInTheDocument();
    const drawerTitle = container.querySelector('.drawer h2');
    expect(drawerTitle).toHaveTextContent('Line 3');
    expect(container.querySelector('.drawer pre')).toHaveTextContent(/payroll.get_salaries/);
  });

  it('toggles between Graph view and strace flat log view', () => {
    render(<App />);
    const straceTab = screen.getByText('strace');
    fireEvent.click(straceTab);

    expect(screen.getByText('Event log')).toBeInTheDocument();
    expect(screen.getAllByText('tracker.list_issues').length).toBeGreaterThan(0);

    const graphTab = screen.getByText('Graph');
    fireEvent.click(graphTab);
    expect(screen.getByText('Follow the flow')).toBeInTheDocument();
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

    // Step 9 node tracker.post_comment should be hidden now
    expect(screen.queryByText('tracker.post_comment')).not.toBeInTheDocument();

    // Click next step
    fireEvent.click(nextBtn);
    expect(stepLabel).toHaveTextContent('STEP 04 / 09');
  });

  it('switches trace mode between Lineage and Blast radius', () => {
    render(<App />);
    const blastBtn = screen.getByText('Blast radius');
    const lineageBtn = screen.getByText('Lineage');

    fireEvent.click(blastBtn);
    expect(blastBtn).toHaveClass('active');

    fireEvent.click(lineageBtn);
    expect(lineageBtn).toHaveClass('active');
  });
});
