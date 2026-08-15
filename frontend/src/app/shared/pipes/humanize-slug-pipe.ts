import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'humanizeSlug',
})
export class HumanizeSlugPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const [first, ...rest] = value.split(/[_-]+/);
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
  }
}
