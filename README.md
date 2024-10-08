# ngx-nested-ellipsis

Library for angular (>= 16.0.0) providing a directive to display an ellipsis if the containing text would overflow.

Supports dynamic html contents. (If you require text contents only, you might want to take a look at [ngx-ellipsis](https://github.com/lentschi/ngx-ellipsis), which offers better performance, but escapes any html contents to text.)

## Demo

For a demo either just checkout this project and run `npm install && npm run start` or visit [the StackBlitz demo page](https://stackblitz.com/github/lentschi/ngx-nested-ellipsis?file=src%2Fapp%2Fapp.component.html).

## Installation

For use in an existing angular project run `npm install ngx-nested-ellipsis --save`.

Then add the directive to the component, in which you want to use the ellipsis:

```typescript
import { NestedEllipsisDirective } from 'ngx-nested-ellipsis';

@Component({
  // ...
  imports: [
    // ...
    NestedEllipsisDirective
  ]
  standalone: true
})
export class YourFancyComponent {}

```

## Usage

Anywhere in your template:

```html
<div style="width: 130px; height: 18px;">
  <ng-template [nestedEllipsis]>Your very long <em>rich</em> text</ng-template>
</div>
```

As you can see, you need to define the dimensions of your element yourself. (ngx-nested-ellipsis doesn't automatically add any element styles.) But of course you don't need to use fixed widths/heights like in these examples. Flex layout shold work just fine for example.

### Module import

Should you not be using [angular standalone components](https://blog.angular-university.io/angular-standalone-components/) in your project (available since angular 16), import `NestedEllipsisModule` in your module instead - see [old instructions](https://github.com/lentschi/ngx-nested-ellipsis/blob/v2.1.5/README.md#installation) for an example.

### Extra options

You may add the following attributes to change the directive's behavior:

| attribute | meaning |
| ---- | ---- |
| __nestedEllipsis__ | _required_ Passing true (default) will perform the directive's task otherwise the template will be rendered without truncating its contents.|
| __nestedEllipsisIndicator__ | Passing a string (default: '...') will append it when the passed template has been truncated. Passing a template will append that template instead. |
| __nestedEllipsisWordBoundaries__ | If you pass this attribute, the text won't be truncated at just any character but only at those in the attribute's value. For example `nestedEllipsisWordBoundaries=" "` will allow the text to break at spaces only |
| __nestedEllipsisMayTruncateAtFn__ | Function that lets you specify whether the contents may be truncated at a certain point or not. (see [callback API](#nestedellipsismaytruncateatfn-api)) |
| __nestedEllipsisResizeDetection__ | How resize events should be detected - these are the possible values: <ul><li>__resize-observer__: _default_ Use native ResizeObserver (See [Web/API/ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver))</li><li>__window__: Only listen if the whole window has been resized/changed orientation (Possibly better performance, but obviously won't trigger on resize caused directly or indirectly by javascript.)</li><li>__manual__: Ellipsis is never applied automatically. Instead the consuming app may use `#ell="ngxNestedEllipsis"` in the template and `this.ell.applyEllipsis()` in the component code.</li></ul> |
| __nestedEllipsisChange__ | Event emitter - Will be emitted whenever the ellipsis has been recalculated (depending on `nestedEllipsisResizeDetection`). If the text had to be truncated the position of the last visible character will be emitted, else `null`.|

### nestedEllipsisMayTruncateAtFn API

Callback function parameters:

| name | type | description |
| ---- | ---- | ---- |
| __node__ | CharacterData | Text node that is checked for truncation |
| __position__ | number | Position within that text node where the text might be truncated |

Return `true` if truncating at this point in this node should be allowed.

## Build & publish on npm

In case you want to contribute/fork:

1. Run `npm ci`
1. Adept version and author in `./projects/ngx-nested-ellipsis/package.json` and `./README` and commit the changes to your fork.
1. Run `npm run build-lib` which outputs the build to `./dist/ngx-nested-ellipsis`.
1. To publish your build, run `npm run publish-lib`.


## Running unit tests

Run `npm run test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## License

MIT
