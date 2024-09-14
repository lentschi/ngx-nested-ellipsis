import { NgModule } from '@angular/core';
import { NestedEllipsisDirective } from './directives/nested-ellipsis.directive';

@NgModule({
  imports: [NestedEllipsisDirective],
  exports: [NestedEllipsisDirective]
  })
export class NestedEllipsisModule { }
