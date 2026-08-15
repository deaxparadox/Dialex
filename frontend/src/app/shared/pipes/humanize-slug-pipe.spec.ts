import { HumanizeSlugPipe } from './humanize-slug-pipe';

describe('HumanizeSlugPipe', () => {
  const pipe = new HumanizeSlugPipe();

  it('create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('humanizes an underscore-separated slug', () => {
    expect(pipe.transform('loan_approval')).toBe('Loan approval');
    expect(pipe.transform('research_debate')).toBe('Research debate');
  });

  it('handles a single-word slug', () => {
    expect(pipe.transform('approval')).toBe('Approval');
  });

  it('handles hyphens the same as underscores', () => {
    expect(pipe.transform('multi-word-slug')).toBe('Multi word slug');
  });

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });
});
