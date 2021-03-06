/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2016, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
import {
  IDisposable
} from 'phosphor-core/lib/disposable';

import {
  each, map, reduce, toArray
} from 'phosphor-core/lib/iteration';

import {
  Message, sendMessage
} from 'phosphor-core/lib/messaging';

import {
  move
} from 'phosphor-core/lib/mutation';

import {
  AttachedProperty
} from 'phosphor-core/lib/properties';

import {
  findIndex
} from 'phosphor-core/lib/searching';

import {
  ISequence
} from 'phosphor-core/lib/sequence';

import {
  Vector
} from 'phosphor-core/lib/vector';

import {
  BoxSizer, boxCalc
} from './boxengine';

import {
  overrideCursor
} from './cssutil';

import {
  IBoxSizing, boxSizing, sizeLimits
} from './domutil';

import {
  prepareGeometry, resetGeometry, setGeometry
} from './layoututil';

import {
  Panel, PanelLayout
} from './panel';

import {
  ChildMessage, ResizeMessage, Widget, WidgetMessage
} from './widget';


/**
 * The class name added to SplitPanel instances.
 */
const SPLIT_PANEL_CLASS = 'p-SplitPanel';

/**
 * The class name added to split panel children.
 */
const CHILD_CLASS = 'p-SplitPanel-child';

/**
 * The class name added to split panel handles.
 */
const HANDLE_CLASS = 'p-SplitPanel-handle';

/**
 * The class name added to hidden split handles.
 */
const HIDDEN_CLASS = 'p-mod-hidden';

/**
 * The class name added to horizontal split panels.
 */
const HORIZONTAL_CLASS = 'p-mod-horizontal';

/**
 * The class name added to vertical split panels.
 */
const VERTICAL_CLASS = 'p-mod-vertical';


/**
 * The orientation of a split layout.
 */
export
enum Orientation {
  /**
   * Left-to-right horizontal orientation.
   */
  Horizontal,

  /**
   * Top-to-bottom vertical orientation.
   */
  Vertical
}


/**
 * A panel which arranges its widgets into resizable sections.
 *
 * #### Notes
 * This class provides a convenience wrapper around a [[SplitLayout]].
 */
export
class SplitPanel extends Panel {
  /**
   * Create a split layout for a split panel.
   */
  static createLayout(): SplitLayout {
    return new SplitLayout(this);
  }

  /**
   * Create a split handle for use in a split panel.
   *
   * #### Notes
   * This may be reimplemented to create custom split handles.
   */
  static createHandle(): HTMLElement {
    let handle = document.createElement('div');
    handle.className = HANDLE_CLASS;
    return handle;
  }

  /**
   * Construct a new split panel.
   */
  constructor() {
    super();
    this.addClass(SPLIT_PANEL_CLASS);
  }

  /**
   * Dispose of the resources held by the panel.
   */
  dispose(): void {
    this._releaseMouse();
    super.dispose();
  }

  /**
   * Get the layout orientation for the split panel.
   */
  get orientation(): Orientation {
    return (this.layout as SplitLayout).orientation;
  }

  /**
   * Set the layout orientation for the split panel.
   */
  set orientation(value: Orientation) {
    (this.layout as SplitLayout).orientation = value;
  }

  /**
   * Get the inter-element spacing for the split panel.
   */
  get spacing(): number {
    return (this.layout as SplitLayout).spacing;
  }

  /**
   * Set the inter-element spacing for the split panel.
   */
  set spacing(value: number) {
    (this.layout as SplitLayout).spacing = value;
  }

  /**
   * A read-only sequence of the split handles in the panel.
   *
   * #### Notes
   * This is a read-only property.
   */
  get handles(): ISequence<HTMLElement> {
    return (this.layout as SplitLayout).handles;
  }

  /**
   * Get the current sizes of the widgets in the panel.
   *
   * @returns A new array of the current sizes of the widgets.
   *
   * #### Notes
   * The returned sizes reflect the internal cached sizes as of the
   * most recent update, or the most recent call to [[setSizes]].
   *
   * This method **does not** measure the DOM nodes.
   */
  sizes(): number[] {
    return (this.layout as SplitLayout).sizes();
  }

  /**
   * Set the desired sizes for the widgets in the panel.
   *
   * @param sizes - The desired sizes for the widgets in the panel.
   *
   * #### Notes
   * Extra values are ignored, too few will yield an undefined layout.
   *
   * The widgets will be sized as close as possible to the desired size
   * without violating the widget size constraints.
   *
   * The actual geometry of the DOM nodes is updated asynchronously.
   */
  setSizes(sizes: number[]): void {
    (this.layout as SplitLayout).setSizes(sizes);
  }

  /**
   * Handle the DOM events for the split panel.
   *
   * @param event - The DOM event sent to the panel.
   *
   * #### Notes
   * This method implements the DOM `EventListener` interface and is
   * called in response to events on the panel's DOM node. It should
   * not be called directly by user code.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
    case 'mousedown':
      this._evtMouseDown(event as MouseEvent);
      break;
    case 'mousemove':
      this._evtMouseMove(event as MouseEvent);
      break;
    case 'mouseup':
      this._evtMouseUp(event as MouseEvent);
      break;
    case 'keydown':
      this._evtKeyDown(event as KeyboardEvent);
      break;
    case 'keyup':
    case 'keypress':
    case 'contextmenu':
      // Stop input events during drag.
      event.preventDefault();
      event.stopPropagation();
      break;
    }
  }

  /**
   * A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    this.node.addEventListener('mousedown', this);
  }

  /**
   * A message handler invoked on a `'before-detach'` message.
   */
  protected onBeforeDetach(msg: Message): void {
    this.node.removeEventListener('mousedown', this);
    this._releaseMouse();
  }

  /**
   * A message handler invoked on a `'child-added'` message.
   */
  protected onChildAdded(msg: ChildMessage): void {
    msg.child.addClass(CHILD_CLASS);
    this._releaseMouse();
  }

  /**
   * A message handler invoked on a `'child-removed'` message.
   */
  protected onChildRemoved(msg: ChildMessage): void {
    msg.child.removeClass(CHILD_CLASS);
    this._releaseMouse();
  }

  /**
   * Handle the `'keydown'` event for the split panel.
   */
  private _evtKeyDown(event: KeyboardEvent): void {
    // Stop input events during drag.
    event.preventDefault();
    event.stopPropagation();

    // Release the mouse if `Escape` is pressed.
    if (event.keyCode === 27) this._releaseMouse();
  }

  /**
   * Handle the `'mousedown'` event for the split panel.
   */
  private _evtMouseDown(event: MouseEvent): void {
    // Do nothing if the left mouse button is not pressed.
    if (event.button !== 0) {
      return;
    }

    // Find the handle which contains the mouse target, if any.
    let layout = this.layout as SplitLayout;
    let target = event.target as HTMLElement;
    let index = findIndex(layout.handles, handle => handle.contains(target));
    if (index === -1) {
      return;
    }

    // Stop the event when a split handle is pressed.
    event.preventDefault();
    event.stopPropagation();

    // Add the extra document listeners.
    document.addEventListener('mouseup', this, true);
    document.addEventListener('mousemove', this, true);
    document.addEventListener('keydown', this, true);
    document.addEventListener('keyup', this, true);
    document.addEventListener('keypress', this, true);
    document.addEventListener('contextmenu', this, true);

    // Compute the offset delta for the handle press.
    let delta: number;
    let handle = layout.handles.at(index);
    let rect = handle.getBoundingClientRect();
    if (layout.orientation === Orientation.Horizontal) {
      delta = event.clientX - rect.left;
    } else {
      delta = event.clientY - rect.top;
    }

    // Override the cursor and store the press data.
    let style = window.getComputedStyle(handle);
    let override = overrideCursor(style.cursor);
    this._pressData = { index, delta, override };
  }

  /**
   * Handle the `'mousemove'` event for the split panel.
   */
  private _evtMouseMove(event: MouseEvent): void {
    // Stop the event when dragging a split handle.
    event.preventDefault();
    event.stopPropagation();

    // Compute the desired offset position for the handle.
    let pos: number;
    let layout = this.layout as SplitLayout;
    let rect = this.node.getBoundingClientRect();
    if (layout.orientation === Orientation.Horizontal) {
      pos = event.clientX - rect.left - this._pressData.delta;
    } else {
      pos = event.clientY - rect.top - this._pressData.delta;
    }

    // Set the handle as close to the desired position as possible.
    layout.setHandlePosition(this._pressData.index, pos);
  }

  /**
   * Handle the `'mouseup'` event for the split panel.
   */
  private _evtMouseUp(event: MouseEvent): void {
    // Do nothing if the left mouse button is not released.
    if (event.button !== 0) {
      return;
    }

    // Stop the event when releasing a handle.
    event.preventDefault();
    event.stopPropagation();

    // Finalize the mouse release.
    this._releaseMouse();
  }

  /**
   * Release the mouse grab for the split panel.
   */
  private _releaseMouse(): void {
    // Bail early if no drag is in progress.
    if (!this._pressData) {
      return;
    }

    // Clear the override cursor.
    this._pressData.override.dispose();
    this._pressData = null;

    // Remove the extra document listeners.
    document.removeEventListener('mouseup', this, true);
    document.removeEventListener('mousemove', this, true);
    document.removeEventListener('keydown', this, true);
    document.removeEventListener('keyup', this, true);
    document.removeEventListener('keypress', this, true);
    document.removeEventListener('contextmenu', this, true);
  }

  private _pressData: Private.IPressData = null;
}


/**
 * The namespace for the `SplitPanel` class statics.
 */
export
namespace SplitPanel {
  /**
   * A convenience alias of the `Horizontal` [[Orientation]].
   */
  export
  const Horizontal = Orientation.Horizontal;

  /**
   * A convenience alias of the `Vertical` [[Orientation]].
   */
  export
  const Vertical = Orientation.Vertical;

  /**
   * Get the split panel stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The split panel stretch factor for the widget.
   */
  export
  function getStretch(widget: Widget): number {
    return SplitLayout.getStretch(widget);
  }

  /**
   * Set the split panel stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the stretch factor.
   */
  export
  function setStretch(widget: Widget, value: number): void {
    SplitLayout.setStretch(widget, value);
  }
}


/**
 * A factory object which creates handles for a split layout.
 */
export
interface IHandleFactory {
  /**
   * Create a new split handle for use with a split layout.
   *
   * @returns A new split handle node.
   */
  createHandle(): HTMLElement;
}


/**
 * A layout which arranges its widgets into resizable sections.
 */
export
class SplitLayout extends PanelLayout {
  /**
   * Construct a new split layout.
   *
   * @param factory - The handle factory for creating split handles.
   */
  constructor(factory: IHandleFactory) {
    super();
    this._factory = factory;
  }

  /**
   * Get the layout orientation for the split layout.
   */
  get orientation(): Orientation {
    return this._orientation;
  }

  /**
   * Set the layout orientation for the split layout.
   */
  set orientation(value: Orientation) {
    if (this._orientation === value) {
      return;
    }
    this._orientation = value;
    if (!this.parent) {
      return;
    }
    Private.toggleOrientation(this.parent, value);
    this.parent.fit();
  }

  /**
   * Get the inter-element spacing for the split layout.
   */
  get spacing(): number {
    return this._spacing;
  }

  /**
   * Set the inter-element spacing for the split layout.
   */
  set spacing(value: number) {
    value = Math.max(0, Math.floor(value));
    if (this._spacing === value) {
      return;
    }
    this._spacing = value;
    if (!this.parent) {
      return;
    }
    this.parent.fit();
  }

  /**
   * A read-only sequence of the split handles in the layout.
   *
   * #### Notes
   * This is a read-only property.
   */
  get handles(): ISequence<HTMLElement> {
    return this._handles;
  }

  /**
   * Get the current sizes of the widgets in the layout.
   *
   * @returns A new array of the current sizes of the widgets.
   *
   * #### Notes
   * The returned sizes reflect the internal cached sizes as of the
   * most recent update, or the most recent call to [[setSizes]].
   *
   * This method **does not** measure the DOM nodes.
   */
  sizes(): number[] {
    return toArray(map(this._sizers, sizer => sizer.size));
  }

  /**
   * Set the desired sizes for the widgets in the panel.
   *
   * @param sizes - The desired sizes for the widgets in the panel.
   *
   * #### Notes
   * Extra values are ignored, too few will yield an undefined layout.
   *
   * The widgets will be sized as close as possible to the desired size
   * without violating the widget size constraints.
   *
   * The actual geometry of the DOM nodes is updated asynchronously.
   */
  setSizes(sizes: number[]): void {
    let n = Math.min(this._sizers.length, sizes.length);
    for (let i = 0; i < n; ++i) {
      let hint = Math.max(0, sizes[i]);
      let sizer = this._sizers.at(i);
      sizer.sizeHint = hint;
      sizer.size = hint;
    }
    if (this.parent) this.parent.update();
  }

  /**
   * Set the offset position of a split handle.
   *
   * @param index - The index of the handle of the interest.
   *
   * @param position - The desired offset position of the handle.
   *
   * #### Notes
   * The position is relative to the offset parent.
   *
   * This will move the handle as close as possible to the desired
   * position. The sibling widgets will be adjusted as necessary.
   *
   * #### Undefined Behavior
   * An `index` which is non-integral or out of range.
   */
  setHandlePosition(index: number, position: number): void {
    // Bail if the index is invalid or the handle is hidden.
    let handle = this._handles.at(index);
    if (!handle || handle.classList.contains(HIDDEN_CLASS)) {
      return;
    }

    // Compute the desired delta movement for the handle.
    let delta: number;
    if (this._orientation === Orientation.Horizontal) {
      delta = position - handle.offsetLeft;
    } else {
      delta = position - handle.offsetTop;
    }

    // Bail if there is no handle movement.
    if (delta === 0) {
      return;
    }

    // Prevent widget resizing unless needed.
    each(this._sizers, sizer => {
      if (sizer.size > 0) sizer.sizeHint = sizer.size;
    });

    // Adjust the sizers to reflect the handle movement.
    if (delta > 0) {
      Private.growSizer(this._sizers, index, delta);
    } else {
      Private.shrinkSizer(this._sizers, index, -delta);
    }

    // Update the layout of the widgets.
    if (this.parent) this.parent.update();
  }

  /**
   * Attach a widget to the parent's DOM node.
   *
   * @param index - The current index of the widget in the layout.
   *
   * @param widget - The widget to attach to the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected attachWidget(index: number, widget: Widget): void {
    // Create and add the handle and sizer for the new widget.
    let handle = Private.createHandle(this._factory);
    let average = Private.averageSize(this._sizers);
    let sizer = Private.createSizer(average);
    this._sizers.insert(index, sizer);
    this._handles.insert(index, handle);

    // Prepare the layout geometry for the widget.
    prepareGeometry(widget);

    // Add the widget and handle nodes to the parent.
    this.parent.node.appendChild(widget.node);
    this.parent.node.appendChild(handle);

    // Send an `'after-attach'` message if the parent is attached.
    if (this.parent.isAttached) sendMessage(widget, WidgetMessage.AfterAttach);

    // Post a layout request for the parent widget.
    this.parent.fit();
  }

  /**
   * Move a widget in the parent's DOM node.
   *
   * @param fromIndex - The previous index of the widget in the layout.
   *
   * @param toIndex - The current index of the widget in the layout.
   *
   * @param widget - The widget to move in the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected moveWidget(fromIndex: number, toIndex: number, widget: Widget): void {
    // Move the sizer and handle for the widget.
    move(this._sizers, fromIndex, toIndex);
    move(this._handles, fromIndex, toIndex);

    // Post a fit request to the parent to show/hide last handle.
    this.parent.fit();
  }

  /**
   * Detach a widget from the parent's DOM node.
   *
   * @param index - The previous index of the widget in the layout.
   *
   * @param widget - The widget to detach from the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected detachWidget(index: number, widget: Widget): void {
    // Fetch the handle for the widget.
    let handle = this._handles.at(index);

    // Remove the sizer and handle for the widget.
    this._sizers.remove(index);
    this._handles.remove(index);

    // Send a `'before-detach'` message if the parent is attached.
    if (this.parent.isAttached) sendMessage(widget, WidgetMessage.BeforeDetach);

    // Remove the widget and handle nodes from the parent.
    this.parent.node.removeChild(widget.node);
    this.parent.node.removeChild(handle);

    // Reset the layout geometry for the widget.
    resetGeometry(widget);

    // Post a layout request for the parent widget.
    this.parent.fit();
  }

  /**
   * A message handler invoked on a `'layout-changed'` message.
   *
   * #### Notes
   * This is called when the layout is installed on its parent.
   */
  protected onLayoutChanged(msg: Message): void {
    Private.toggleOrientation(this.parent, this.orientation);
    super.onLayoutChanged(msg);
  }

  /**
   * A message handler invoked on an `'after-show'` message.
   */
  protected onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    this.parent.update();
  }

  /**
   * A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.parent.fit();
  }

  /**
   * A message handler invoked on a `'child-shown'` message.
   */
  protected onChildShown(msg: ChildMessage): void {
    if (Private.IsIE) { // prevent flicker on IE
      sendMessage(this.parent, WidgetMessage.FitRequest);
    } else {
      this.parent.fit();
    }
  }

  /**
   * A message handler invoked on a `'child-hidden'` message.
   */
  protected onChildHidden(msg: ChildMessage): void {
    if (Private.IsIE) { // prevent flicker on IE
      sendMessage(this.parent, WidgetMessage.FitRequest);
    } else {
      this.parent.fit();
    }
  }

  /**
   * A message handler invoked on a `'resize'` message.
   */
  protected onResize(msg: ResizeMessage): void {
    if (this.parent.isVisible) {
      this._update(msg.width, msg.height);
    }
  }

  /**
   * A message handler invoked on an `'update-request'` message.
   */
  protected onUpdateRequest(msg: Message): void {
    if (this.parent.isVisible) {
      this._update(-1, -1);
    }
  }

  /**
   * A message handler invoked on a `'fit-request'` message.
   */
  protected onFitRequest(msg: Message): void {
    if (this.parent.isAttached) {
      this._fit();
    }
  }

  /**
   * Fit the layout to the total size required by the widgets.
   */
  private _fit(): void {
    // Update the handles and track the visible widget count.
    let nVisible = 0;
    let widgets = this.widgets;
    let lastHandle: HTMLElement = null;
    for (let i = 0, n = widgets.length; i < n; ++i) {
      let handle = this._handles.at(i);
      if (widgets.at(i).isHidden) {
        handle.classList.add(HIDDEN_CLASS);
      } else {
        handle.classList.remove(HIDDEN_CLASS);
        lastHandle = handle;
        nVisible++;
      }
    }

    // Hide the handle for the last visible widget.
    if (lastHandle) lastHandle.classList.add(HIDDEN_CLASS);

    // Update the fixed space for the visible items.
    this._fixed = this._spacing * Math.max(0, nVisible - 1);

    // Setup the initial size limits.
    let minW = 0;
    let minH = 0;
    let maxW = Infinity;
    let maxH = Infinity;
    let horz = this._orientation === Orientation.Horizontal;
    if (horz) {
      minW = this._fixed;
      maxW = nVisible > 0 ? minW : maxW;
    } else {
      minH = this._fixed;
      maxH = nVisible > 0 ? minH : maxH;
    }

    // Update the sizers and computed size limits.
    for (let i = 0, n = widgets.length; i < n; ++i) {
      let widget = widgets.at(i);
      let sizer = this._sizers.at(i);
      if (sizer.size > 0) {
        sizer.sizeHint = sizer.size;
      }
      if (widget.isHidden) {
        sizer.minSize = 0;
        sizer.maxSize = 0;
        continue;
      }
      let limits = sizeLimits(widget.node);
      sizer.stretch = SplitLayout.getStretch(widget);
      if (horz) {
        sizer.minSize = limits.minWidth;
        sizer.maxSize = limits.maxWidth;
        minW += limits.minWidth;
        maxW += limits.maxWidth;
        minH = Math.max(minH, limits.minHeight);
        maxH = Math.min(maxH, limits.maxHeight);
      } else {
        sizer.minSize = limits.minHeight;
        sizer.maxSize = limits.maxHeight;
        minH += limits.minHeight;
        maxH += limits.maxHeight;
        minW = Math.max(minW, limits.minWidth);
        maxW = Math.min(maxW, limits.maxWidth);
      }
    }

    // Update the box sizing and add it to the size constraints.
    let box = this._box = boxSizing(this.parent.node);
    minW += box.horizontalSum;
    minH += box.verticalSum;
    maxW += box.horizontalSum;
    maxH += box.verticalSum;

    // Update the parent's size constraints.
    let style = this.parent.node.style;
    style.minWidth = `${minW}px`;
    style.minHeight = `${minH}px`;
    style.maxWidth = maxW === Infinity ? 'none' : `${maxW}px`;
    style.maxHeight = maxH === Infinity ? 'none' : `${maxH}px`;

    // Set the dirty flag to ensure only a single update occurs.
    this._dirty = true;

    // Notify the ancestor that it should fit immediately. This may
    // cause a resize of the parent, fulfilling the required update.
    let ancestor = this.parent.parent;
    if (ancestor) sendMessage(ancestor, WidgetMessage.FitRequest);

    // If the dirty flag is still set, the parent was not resized.
    // Trigger the required update on the parent widget immediately.
    if (this._dirty) sendMessage(this.parent, WidgetMessage.UpdateRequest);
  }

  /**
   * Update the layout position and size of the widgets.
   *
   * The parent offset dimensions should be `-1` if unknown.
   */
  private _update(offsetWidth: number, offsetHeight: number): void {
    // Clear the dirty flag to indicate the update occurred.
    this._dirty = false;

    // Bail early if there are no widgets to layout.
    let widgets = this.widgets;
    if (widgets.length === 0) {
      return;
    }

    // Measure the parent if the offset dimensions are unknown.
    if (offsetWidth < 0) {
      offsetWidth = this.parent.node.offsetWidth;
    }
    if (offsetHeight < 0) {
      offsetHeight = this.parent.node.offsetHeight;
    }

    // Ensure the parent box sizing data is computed.
    let box = this._box || (this._box = boxSizing(this.parent.node));

    // Compute the actual layout bounds adjusted for border and padding.
    let top = box.paddingTop;
    let left = box.paddingLeft;
    let width = offsetWidth - box.horizontalSum;
    let height = offsetHeight - box.verticalSum;

    // Compute the adjusted layout space.
    let space: number;
    let horz = this._orientation === Orientation.Horizontal;
    if (horz) {
      space = Math.max(0, width - this._fixed);
    } else {
      space = Math.max(0, height - this._fixed);
    }

    // Distribute the layout space to the box sizers.
    boxCalc(this._sizers, space);

    // Layout the widgets using the computed box sizes.
    let spacing = this._spacing;
    for (let i = 0, n = widgets.length; i < n; ++i) {
      let widget = widgets.at(i);
      if (widget.isHidden) {
        continue;
      }
      let size = this._sizers.at(i).size;
      let hstyle = this._handles.at(i).style;
      if (horz) {
        setGeometry(widget, left, top, size, height);
        left += size;
        hstyle.top = `${top}px`;
        hstyle.left = `${left}px`;
        hstyle.width = `${spacing}px`;
        hstyle.height = `${height}px`;
        left += spacing;
      } else {
        setGeometry(widget, left, top, width, size);
        top += size;
        hstyle.top = `${top}px`;
        hstyle.left = `${left}px`;
        hstyle.width = `${width}px`;
        hstyle.height = `${spacing}px`;
        top += spacing;
      }
    }
  }

  private _fixed = 0;
  private _spacing = 3;
  private _dirty = false;
  private _box: IBoxSizing = null;
  private _factory: IHandleFactory;
  private _sizers = new Vector<BoxSizer>();
  private _handles = new Vector<HTMLElement>();
  private _orientation = Orientation.Horizontal;
}


/**
 * The namespace for the `SplitLayout` class statics.
 */
export
namespace SplitLayout {
  /**
   * A convenience alias of the `Horizontal` [[Orientation]].
   */
  export
  const Horizontal = Orientation.Horizontal;

  /**
   * A convenience alias of the `Vertical` [[Orientation]].
   */
  export
  const Vertical = Orientation.Vertical;

  /**
   * Get the split layout stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The split layout stretch factor for the widget.
   */
  export
  function getStretch(widget: Widget): number {
    return Private.stretchProperty.get(widget);
  }

  /**
   * Set the split layout stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the stretch factor.
   */
  export
  function setStretch(widget: Widget, value: number): void {
    Private.stretchProperty.set(widget, value);
  }
}


/**
 * The namespace for the private module data.
 */
namespace Private {
  /**
   * An object which holds mouse press data.
   */
  export
  interface IPressData {
    /**
     * The index of the pressed handle.
     */
    index: number;

    /**
     * The offset of the press in handle coordinates.
     */
    delta: number;

    /**
     * The disposable which will clear the override cursor.
     */
    override: IDisposable;
  }

  /**
   * A flag indicating whether the browser is IE.
   */
  export
  const IsIE = /Trident/.test(navigator.userAgent);

  /**
   * The property descriptor for a widget stretch factor.
   */
  export
  const stretchProperty = new AttachedProperty<Widget, number>({
    name: 'stretch',
    value: 0,
    coerce: (owner, value) => Math.max(0, Math.floor(value)),
    changed: onChildPropertyChanged
  });

  /**
   * Create a new box sizer with the given size hint.
   */
  export
  function createSizer(size: number): BoxSizer {
    let sizer = new BoxSizer();
    sizer.sizeHint = Math.floor(size);
    return sizer;
  }

  /**
   * Create a new split handle using the given factory.
   */
  export
  function createHandle(factory: IHandleFactory): HTMLElement {
    let handle = factory.createHandle();
    handle.style.position = 'absolute';
    return handle;
  }

  /**
   * Toggle the CSS orientation class for the given widget.
   */
  export
  function toggleOrientation(widget: Widget, orient: Orientation): void {
    widget.toggleClass(HORIZONTAL_CLASS, orient === Orientation.Horizontal);
    widget.toggleClass(VERTICAL_CLASS, orient === Orientation.Vertical);
  }

  /**
   * Compute the average size of a vector of box sizers.
   */
  export
  function averageSize(sizers: Vector<BoxSizer>): number {
    return reduce(sizers, (v, s) => v + s.size, 0) / sizers.length || 0;
  }

  /**
   * Grow a sizer to the right by a positive delta and adjust neighbors.
   */
  export
  function growSizer(sizers: Vector<BoxSizer>, index: number, delta: number): void {
    // Compute how much the items to the left can expand.
    let growLimit = 0;
    for (let i = 0; i <= index; ++i) {
      let sizer = sizers.at(i);
      growLimit += sizer.maxSize - sizer.size;
    }

    // Compute how much the items to the right can shrink.
    let shrinkLimit = 0;
    for (let i = index + 1, n = sizers.length; i < n; ++i) {
      let sizer = sizers.at(i);
      shrinkLimit += sizer.size - sizer.minSize;
    }

    // Clamp the delta adjustment to the limits.
    delta = Math.min(delta, growLimit, shrinkLimit);

    // Grow the sizers to the left by the delta.
    let grow = delta;
    for (let i = index; i >= 0 && grow > 0; --i) {
      let sizer = sizers.at(i);
      let limit = sizer.maxSize - sizer.size;
      if (limit >= grow) {
        sizer.sizeHint = sizer.size + grow;
        grow = 0;
      } else {
        sizer.sizeHint = sizer.size + limit;
        grow -= limit;
      }
    }

    // Shrink the sizers to the right by the delta.
    let shrink = delta;
    for (let i = index + 1, n = sizers.length; i < n && shrink > 0; ++i) {
      let sizer = sizers.at(i);
      let limit = sizer.size - sizer.minSize;
      if (limit >= shrink) {
        sizer.sizeHint = sizer.size - shrink;
        shrink = 0;
      } else {
        sizer.sizeHint = sizer.size - limit;
        shrink -= limit;
      }
    }
  }

  /**
   * Shrink a sizer to the left by a positive delta and adjust neighbors.
   */
  export
  function shrinkSizer(sizers: Vector<BoxSizer>, index: number, delta: number): void {
    // Compute how much the items to the right can expand.
    let growLimit = 0;
    for (let i = index + 1, n = sizers.length; i < n; ++i) {
      let sizer = sizers.at(i);
      growLimit += sizer.maxSize - sizer.size;
    }

    // Compute how much the items to the left can shrink.
    let shrinkLimit = 0;
    for (let i = 0; i <= index; ++i) {
      let sizer = sizers.at(i);
      shrinkLimit += sizer.size - sizer.minSize;
    }

    // Clamp the delta adjustment to the limits.
    delta = Math.min(delta, growLimit, shrinkLimit);

    // Grow the sizers to the right by the delta.
    let grow = delta;
    for (let i = index + 1, n = sizers.length; i < n && grow > 0; ++i) {
      let sizer = sizers.at(i);
      let limit = sizer.maxSize - sizer.size;
      if (limit >= grow) {
        sizer.sizeHint = sizer.size + grow;
        grow = 0;
      } else {
        sizer.sizeHint = sizer.size + limit;
        grow -= limit;
      }
    }

    // Shrink the sizers to the left by the delta.
    let shrink = delta;
    for (let i = index; i >= 0 && shrink > 0; --i) {
      let sizer = sizers.at(i);
      let limit = sizer.size - sizer.minSize;
      if (limit >= shrink) {
        sizer.sizeHint = sizer.size - shrink;
        shrink = 0;
      } else {
        sizer.sizeHint = sizer.size - limit;
        shrink -= limit;
      }
    }
  }

  /**
   * The change handler for the attached child properties.
   */
  function onChildPropertyChanged(child: Widget): void {
    let parent = child.parent;
    let layout = parent && parent.layout;
    if (layout instanceof SplitLayout) parent.fit();
  }
}
