import {
  Directive,
  Renderer2,
  Input,
  Output,
  EventEmitter,
  NgZone,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  TemplateRef,
  ViewContainerRef,
  ComponentFactoryResolver,
  ComponentFactory,
  EmbeddedViewRef,
  AfterViewChecked,
  OnInit
} from '@angular/core';
import ResizeObserver from 'resize-observer-polyfill';
import { isPlatformBrowser } from '@angular/common';
import { NestedEllipsisContentComponent } from '../components/nested-ellipsis-content.component';
import { EllipsisResizeDetectionEnum } from '../enums/ellipsis-resize-detection.enum';
import { Subject } from 'rxjs';
import { take } from 'rxjs/operators';

/**
 * Directive to truncate the contained text, if it exceeds the element's boundaries
 * and append characters (configurable, default '...') if so.
 */
@Directive({
  selector: '[nestedEllipsis]',
  exportAs: 'ngxNestedEllipsis'
})
export class NestedEllipsisDirective implements OnInit, OnDestroy, AfterViewChecked {
  /**
   * The referenced element
   */
  private elem: HTMLElement;

  /**
   * Component factory required for rendering EllipsisContent component
   */
  private compFactory: ComponentFactory<NestedEllipsisContentComponent>;

  /**
   * ViewRef of the main template (the one to be truncated)
   */
  private templateView: EmbeddedViewRef<unknown>;

  /**
   * ViewRef of the indicator template
   */
  private indicatorView: EmbeddedViewRef<unknown>;

  /**
   * Concatenated template html at the time of the last time the ellipsis has been applied
   */
  private previousTemplateHtml: string;

  /**
   * Text length before truncating
   */
  private initialTextLength: number;

  /**
   * Subject triggered when resize listeners should be removed
   */
  private removeResizeListeners$ = new Subject<void>();

  private previousDimensions: {
    width: number,
    height: number
  };

  /**
   * The ngxNestedEllipsis html attribute
   * Passing true (default) will perform the directive's task,
   * otherwise the template will be rendered without truncating its contents.
   */
  @Input('nestedEllipsis') active: boolean;

  /**
   * The ellipsisIndicator html attribute
   * Passing a string (default: '...') will append it when the passed template has been truncated
   * Passing a template will append that template instead
   */
  @Input('nestedEllipsisIndicator') indicator: string | TemplateRef<unknown>;

  /**
   * The ellipsisWordBoundaries html attribute
   * Each character passed to this input will be interpreted
   * as a word boundary at which the text may be truncated.
   * Else the text may be truncated at any character.
   */
  @Input('nestedEllipsisWordBoundaries') wordBoundaries: string;

  /**
   * The ellipsisMayTruncateAtFn html attribute
   * Function that lets you specify whether the contents may be truncated at a specific point or not:
   * `(node: CharacterData, position: number) => boolean`
   * `node` Text node that is being truncated
   * `position` String position the text would be truncated at
   * Should return true, if the text may be truncated here, else false
   */
  @Input('nestedEllipsisMayTruncateAtFn') mayTruncateAtFn: (node: CharacterData, position: number) => boolean;

  /**
   * The ellipsisResizeDetection html attribute
   * Algorithm to use to detect element/window resize - any value of `EllipsisResizeDetectionEnum`
   */
  @Input('nestedEllipsisResizeDetection') resizeDetection: EllipsisResizeDetectionEnum;


  /**
   * The ellipsisChange html attribute
   * This emits after which index the text has been truncated.
   * If it hasn't been truncated, null is emitted.
   */
  @Output('nestedEllipsisChange') readonly change: EventEmitter<number> = new EventEmitter();

  /**
   * Utility method to quickly find the largest number for
   * which `callback(number)` still returns true.
   * @param  max      Highest possible number
   * @param  callback Should return true as long as the passed number is valid
   * @returns         Largest possible number
   */
  private static numericBinarySearch(max: number, callback: (n: number) => boolean): number {
    let low = 0;
    let high = max;
    let best = -1;
    let mid: number;

    while (low <= high) {
      mid = Math.floor((low + high) / 2);
      const result = callback(mid);
      if (!result) {
        high = mid - 1;
      } else {
        best = mid;
        low = mid + 1;
      }
    }

    return best;
  }

  private flattenTextAndElementNodes(element: HTMLElement): (CharacterData | HTMLElement)[] {
    const nodes: (CharacterData | HTMLElement)[] = [];
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes.item(i);
      if (child instanceof HTMLElement || child instanceof CharacterData) {
        nodes.push(child);

        if (child instanceof HTMLElement) {
          nodes.push(...this.flattenTextAndElementNodes(child));
        }
      }
    }

    return nodes;
  }


  /**
   * The directive's constructor
   */
  public constructor(
    private readonly templateRef: TemplateRef<unknown>,
    private readonly viewContainer: ViewContainerRef,
    private readonly resolver: ComponentFactoryResolver,
    private readonly renderer: Renderer2,
    private readonly ngZone: NgZone,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  /**
   * Angular's onInit life cycle hook.
   * Initializes the element for displaying the ellipsis.
   */
  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      // in angular universal we don't have access to the ugly
      // DOM manipulation properties we sadly need to access here,
      // so wait until we're in the browser:
      return;
    }

    if (typeof(this.active) !== 'boolean') {
      this.active = true;
    }

    if (typeof(this.indicator) === 'undefined') {
      this.indicator = '...';
    }

    if (typeof (this.resizeDetection) === 'undefined') {
      this.resizeDetection = EllipsisResizeDetectionEnum.ResizeObserver;
    }

    // perform regex replace on word boundaries:
    if (!this.wordBoundaries) {
      this.wordBoundaries = '';
    }
    this.wordBoundaries = '[' + this.wordBoundaries.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + ']';

    // initialize view:
    this.compFactory = this.resolver.resolveComponentFactory(NestedEllipsisContentComponent);
    this.restoreView();
    this.previousDimensions = {
      width: this.elem.clientWidth,
      height: this.elem.clientHeight
    };

    this.applyEllipsis();
  }


  /**
   * Angular's destroy life cycle hook.
   * Remove event listeners
   */
  ngOnDestroy() {
    this.removeResizeListeners$.next();
    this.removeResizeListeners$.complete();
  }

  /**
   * Angular's afterViewChecked life cycle hook.
   * Reapply ellipsis, if any of the templates have changed
   */
  ngAfterViewChecked() {
    if (this.resizeDetection !== 'manual') {
      if (this.templatesHaveChanged) {
        this.applyEllipsis();
      }
    }
  }

  /**
   * Convert a list of Nodes to html
   * @param nodes Nodes to convert
   * @returns html code
   */
  private nodesToHtml(nodes: Node[]): string {
    const div = <HTMLElement> this.renderer.createElement('div');
    div.append(...nodes.map(node => node.cloneNode(true)));
    return div.innerHTML;
  }

  /**
   * Convert the passed templates to html
   * @param templateView the main template view ref
   * @param indicatorView the indicator template view ref
   * @returns concatenated template html
   */
  private templatesToHtml(templateView: EmbeddedViewRef<unknown>, indicatorView?: EmbeddedViewRef<unknown>): string {
    let html = this.nodesToHtml(templateView.rootNodes);
    if (indicatorView) {
      html += this.nodesToHtml(indicatorView.rootNodes);
    } else {
      html += <string> this.indicator;
    }

    return html;
  }

  /**
   * Whether any of the passed templates have changed since the last time
   * the ellipsis has been applied
   */
  private get templatesHaveChanged(): boolean {
    if (!this.templateView || !this.previousTemplateHtml) {
      return false;
    }

    const templateView = this.templateRef.createEmbeddedView({});
    templateView.detectChanges();

    const indicatorView = (typeof this.indicator !== 'string') ? this.indicator.createEmbeddedView({}) : null;
    if (indicatorView) {
      indicatorView.detectChanges();
    }

    const templateHtml = this.templatesToHtml(templateView, indicatorView);

    return this.previousTemplateHtml !== templateHtml;
  }

  /**
   * Restore the view from the templates (non-truncated)
   */
  private restoreView() {
    this.viewContainer.clear();
    this.templateView = this.templateRef.createEmbeddedView({});
    this.templateView.detectChanges();
    const componentRef = this.viewContainer.createComponent(
      this.compFactory, null, this.viewContainer.injector, [this.templateView.rootNodes]
    );
    this.elem = componentRef.instance.elementRef.nativeElement;
    this.initialTextLength = this.currentLength;

    this.indicatorView = (typeof this.indicator !== 'string') ? this.indicator.createEmbeddedView({}) : null;
    if (this.indicatorView) {
      this.indicatorView.detectChanges();
    }
  }


  /**
   * Set up an event listener to call applyEllipsis() whenever a resize has been registered.
   * The type of the listener (window/element) depends on the `ellipsisResizeDetection`.
   */
  private addResizeListener() {
    switch (this.resizeDetection) {
      case EllipsisResizeDetectionEnum.Manual:
        // Users will trigger applyEllipsis via the public API
        break;
      case EllipsisResizeDetectionEnum.Window:
        this.addWindowResizeListener();
        break;
      default:
        if (typeof (console) !== 'undefined') {
          console.warn(`
            No such ellipsisResizeDetection strategy: '${this.resizeDetection}'.
            Using '${EllipsisResizeDetectionEnum.ResizeObserver}' instead.
          `);
        }
        this.resizeDetection = EllipsisResizeDetectionEnum.ResizeObserver;
      // eslint-disable-next-line no-fallthrough
      case EllipsisResizeDetectionEnum.ResizeObserver:
        this.addResizeObserver();
        break;
    }
  }

  /**
   * Set up an event listener to call applyEllipsis() whenever the window gets resized.
   */
  private addWindowResizeListener() {
    const removeWindowResizeListener = this.renderer.listen('window', 'resize', () => {
      this.ngZone.run(() => {
        this.applyEllipsis();
      });
    });

    this.removeResizeListeners$.pipe(take(1)).subscribe(() => removeWindowResizeListener());
  }

  /**
   * Set up an event listener to call applyEllipsis() whenever ResizeObserver is triggered for the element.
   */
  private addResizeObserver() {
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (this.previousDimensions.width !== this.elem.clientWidth || this.previousDimensions.height !== this.elem.clientHeight) {
          this.ngZone.run(() => {
            this.applyEllipsis();
          });

          this.previousDimensions.width = this.elem.clientWidth;
          this.previousDimensions.height = this.elem.clientHeight;
        }
      });
    });
    resizeObserver.observe(this.elem);
    this.removeResizeListeners$.pipe(take(1)).subscribe(() => resizeObserver.disconnect());
  }


  /**
   * Get the original text's truncated version. If the text really needed to
   * be truncated, this.ellipsisCharacters will be appended.
   * @param max the maximum length the text may have
   * @returns the text node that has been truncated or null if truncating wasn't required
   */
  private truncateContents(max: number): Node {
    this.restoreView();
    const nodes = <(HTMLElement | CharacterData)[]>this.flattenTextAndElementNodes(this.elem)
      .filter(node => [Node.TEXT_NODE, Node.ELEMENT_NODE].includes(node.nodeType));

    let foundIndex = -1;
    let foundNode: Node;
    let offset = this.initialTextLength;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];

      if (node instanceof CharacterData) {
        offset -= node.data.length;
      } else {
        offset--;
      }

      if (offset <= max) {
        if (node instanceof CharacterData) {
          if (this.wordBoundaries === '[]' && !this.mayTruncateAtFn) {
            node.data = node.data.substr(0, max - offset);
          } else if (max - offset !== node.data.length) {
            let j = max - offset - 1;
            while (
              j > 0 && (
                (this.wordBoundaries !== '[]' && !node.data.charAt(j).match(this.wordBoundaries)) ||
                (this.mayTruncateAtFn && !this.mayTruncateAtFn(node, j))
              )
            ) {
              j--;
            }
            if (offset > 0 && j === 0) {
              continue;
            }
            node.data = node.data.substr(0, j);
          }
        }
        foundIndex = i;
        foundNode = node;
        break;
      }
    }

    for (let i = foundIndex + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.textContent !== '' && node.parentElement !== this.elem && node.parentElement.childNodes.length === 1) {
        node.parentElement.remove();
      } else {
        node.remove();
      }
    }

    return (this.currentLength !== this.initialTextLength) ? foundNode : null;
  }

  private get currentLength(): number {
    return this.flattenTextAndElementNodes(this.elem)
      .filter(node => [Node.TEXT_NODE, Node.ELEMENT_NODE].includes(node.nodeType))
      .map(node => (node instanceof CharacterData) ? node.data.length : 1)
      .reduce((sum, length) => sum + length, 0);
  }

  /**
   * Set the truncated text to be displayed in the inner div
   * @param max the maximum length the text may have
   * @param addMoreListener=false listen for click on the ellipsisCharacters anchor tag if the text has been truncated
   */
  private truncateText(max: number) {
    const truncatedNode = this.truncateContents(max);

    if (truncatedNode) {
      if (!this.indicatorView) {
        if (truncatedNode instanceof CharacterData) {
          truncatedNode.data += <string> this.indicator;
        } else {
          this.renderer.appendChild(this.elem, this.renderer.createText(<string> this.indicator));
        }
      } else {
        for (const node of this.indicatorView.rootNodes) {
          this.renderer.appendChild(this.elem, node);
        }
      }
    }
  }


  /**
   * Display ellipsis in the EllipsisContentComponent if the text would exceed the boundaries
   */
  public applyEllipsis() {
    // Remove the resize listener as changing the contained text would trigger events:
    this.removeResizeListeners$.next();

    // update from templates:
    this.restoreView();

    // remember template state:
    this.previousTemplateHtml = this.templatesToHtml(this.templateView, this.indicatorView);

    // abort if [nestedEllipsis]="false" has been set
    if (!this.active) {
      return;
    }

    // Find the best length by trial and error:
    const maxLength = NestedEllipsisDirective.numericBinarySearch(this.initialTextLength, curLength => {
      this.truncateText(curLength);
      return !this.isOverflowing;
    });

    // Apply the best length:
    this.truncateText(maxLength);

    // Re-attach the resize listener:
    this.addResizeListener();

    // Emit change event:
    if (this.change.observers.length > 0) {
      const currentLength = this.currentLength;
      this.change.emit(
        (currentLength === this.initialTextLength) ? null : currentLength
      );
    }
  }


  /**
   * Whether the text is exceeding the element's boundaries or not
   */
  private get isOverflowing(): boolean {
    // Enforce hidden overflow (required to compare client width/height with scroll width/height)
    const currentOverflow = this.elem.style.overflow;
    if (!currentOverflow || currentOverflow === 'visible') {
      this.elem.style.overflow = 'hidden';
    }

    const isOverflowing = this.elem.clientWidth < this.elem.scrollWidth - 1 || this.elem.clientHeight < this.elem.scrollHeight - 1;

    // Reset overflow to the original configuration:
    this.elem.style.overflow = currentOverflow;

    return isOverflowing;
  }

}
