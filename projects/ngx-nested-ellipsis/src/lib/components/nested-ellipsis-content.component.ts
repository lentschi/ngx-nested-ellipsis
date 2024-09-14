import { Component, ElementRef } from '@angular/core';

@Component({
    selector: 'nested-ellipsis-content',
    template: `
    <ng-content></ng-content>
  `,
    styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
  `],
    standalone: true
})
export class NestedEllipsisContentComponent {
  constructor(public elementRef: ElementRef) {}
}

