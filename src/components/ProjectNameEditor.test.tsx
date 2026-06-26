// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

// --- Mock convex: useMutation returns our spy; api is a placeholder object. ---
const renameMock = vi.fn(() => Promise.resolve());
vi.mock('convex/react', () => ({
  useMutation: () => renameMock,
}));
vi.mock('@convex/_generated/api', () => ({
  api: { projects: { rename: 'projects:rename' } },
}));

const { default: ProjectNameEditor } = await import('./ProjectNameEditor');
const projectId = 'proj_1' as unknown as Parameters<typeof ProjectNameEditor>[0]['projectId'];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ProjectNameEditor', () => {
  it('shows the project name, falling back when empty', () => {
    const { rerender } = render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    expect(screen.getByText('Fade Test')).toBeInTheDocument();

    rerender(<ProjectNameEditor projectId={projectId} name="   " />);
    expect(screen.getByText('Untitled cut')).toBeInTheDocument();
  });

  it('enters edit mode and focuses the input when the pencil is clicked', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    fireEvent.click(screen.getByLabelText('Rename project'));

    const input = screen.getByLabelText('Project name') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Fade Test');
    expect(document.activeElement).toBe(input);
    // The toggle now offers "Save name" instead of "Rename project".
    expect(screen.getByLabelText('Save name')).toBeInTheDocument();
  });

  it('saves a changed name via the rename mutation', async () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    fireEvent.click(screen.getByLabelText('Rename project'));

    const input = screen.getByLabelText('Project name');
    fireEvent.change(input, { target: { value: 'Caesar Cut' } });
    fireEvent.click(screen.getByLabelText('Save name'));

    expect(renameMock).toHaveBeenCalledWith({ projectId, name: 'Caesar Cut' });
  });

  it('commits on Enter and cancels on Escape', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);

    // Enter commits.
    fireEvent.click(screen.getByLabelText('Rename project'));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Buzz' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Enter' });
    expect(renameMock).toHaveBeenCalledWith({ projectId, name: 'Buzz' });

    // Escape discards the edit without calling rename again.
    renameMock.mockClear();
    fireEvent.click(screen.getByLabelText('Rename project'));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Escape' });
    expect(renameMock).not.toHaveBeenCalled();
    expect(screen.getByText('Fade Test')).toBeInTheDocument();
  });

  it('does not call rename when the name is unchanged or blank', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);

    // Unchanged.
    fireEvent.click(screen.getByLabelText('Rename project'));
    fireEvent.click(screen.getByLabelText('Save name'));
    expect(renameMock).not.toHaveBeenCalled();

    // Blank (whitespace only).
    fireEvent.click(screen.getByLabelText('Rename project'));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('Save name'));
    expect(renameMock).not.toHaveBeenCalled();
  });
});
