/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2016, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
import {
  EmptyIterator, IIterator, iter
} from 'phosphor-core/lib/algorithm/iteration';

import {
  IDisposable
} from 'phosphor-core/lib/patterns/disposable';

import {
  IMessageHandler, Message, clearMessageData, postMessage, sendMessage
} from 'phosphor-core/lib/patterns/messaging';

import {
  AttachedProperty, clearPropertyData
} from 'phosphor-core/lib/patterns/properties';

import {
  Signal, clearSignalData
} from 'phosphor-core/lib/patterns/signaling';

import {
  Title
} from '../common/title';

import {
  Layout
} from './layout';

import {
  ChildMessage, ResizeMessage, WidgetMessage
} from './messages';


/**
 * The class name added to Widget instances.
 */
const WIDGET_CLASS = 'p-Widget';

/**
 * The class name added to hidden widgets.
 */
const HIDDEN_CLASS = 'p-mod-hidden';


/**
 * The base class of the Phosphor widget hierarchy.
 *
 * #### Notes
 * This class will typically be subclassed in order to create a useful
 * widget. However, it can be used directly to host externally created
 * content.
 */
export
class Widget implements IDisposable, IMessageHandler {
  /**
   * Create the DOM node for a new widget instance.
   *
   * @returns The DOM node to use for the new widget.
   *
   * #### Notes
   * The default implementation creates an empty `<div>`.
   *
   * This may be reimplemented by a subclass to create a custom node.
   */
  static createNode(): HTMLElement {
    return document.createElement('div');
  }

  /**
   * Construct a new widget.
   *
   * @param node - The optional node to use for the widget.
   *
   * #### Notes
   * If a node is not provided, a new node will be created by calling
   * the static `createNode()` method. This is the typical use case.
   *
   * If a node *is* provided, the widget will assume full ownership and
   * control of the node, as if it had created the node itself. This is
   * less common, but is useful when wrapping foreign nodes as widgets.
   */
  constructor(node?: HTMLElement) {
    this._node = node || (this.constructor as typeof Widget).createNode();
    this.addClass(WIDGET_CLASS);
  }

  /**
   * Dispose of the widget and its descendant widgets.
   *
   * #### Notes
   * It is unsafe to use the widget after it has been disposed.
   *
   * All calls made to this method after the first are a no-op.
   */
  dispose(): void {
    // Do nothing if the widget is already disposed.
    if (this.isDisposed) {
      return;
    }

    // Set the disposed flag and emit the disposed signal.
    this.setFlag(WidgetFlag.IsDisposed);
    Widget.disposed.emit(this, void 0);

    // Remove or detach the widget if necessary.
    if (this.parent) {
      this.parent = null;
    } else if (this.isAttached) {
      Widget.detach(this);
    }

    // Dispose of the widget layout.
    if (this._layout) {
      this._layout.dispose();
      this._layout = null;
    }

    // Clear the attached data associated with the widget.
    clearSignalData(this);
    clearMessageData(this);
    clearPropertyData(this);

    // Clear the reference to the DOM node.
    this._node = null;
  }

  /**
   * Test whether the widget has been disposed.
   *
   * #### Notes
   * This is a read-only property.
   */
  get isDisposed(): boolean {
    return this.testFlag(WidgetFlag.IsDisposed);
  }

  /**
   * Test whether the widget's node is attached to the DOM.
   *
   * #### Notes
   * This is a read-only property.
   */
  get isAttached(): boolean {
    return this.testFlag(WidgetFlag.IsAttached);
  }

  /**
   * Test whether the widget is explicitly hidden.
   *
   * #### Notes
   * This is a read-only property.
   */
  get isHidden(): boolean {
    return this.testFlag(WidgetFlag.IsHidden);
  }

  /**
   * Test whether the widget is visible.
   *
   * #### Notes
   * A widget is visible when it is attached to the DOM, is not
   * explicitly hidden, and has no explicitly hidden ancestors.
   *
   * This is a read-only property.
   */
  get isVisible(): boolean {
    return this.testFlag(WidgetFlag.IsVisible);
  }

  /**
   * Get the DOM node owned by the widget.
   *
   * #### Notes
   * This is a read-only property.
   */
  get node(): HTMLElement {
    return this._node;
  }

  /**
   * Get the id of the widget's DOM node.
   */
  get id(): string {
    return this._node.id;
  }

  /**
   * Set the id of the widget's DOM node.
   */
  set id(value: string) {
    this._node.id = value;
  }

  /**
   * Get the title object for the widget.
   *
   * #### Notes
   * The title object is used by some container widgets when displaying
   * the widget alongside some title, such as a tab panel or side bar.
   *
   * Since not all widgets will use the title, it is created on demand.
   *
   * This is a read-only property.
   */
  get title(): Title<Widget> {
    return WidgetPrivate.title.get(this);
  }

  /**
   * Get the parent of the widget.
   *
   * #### Notes
   * This will be `null` if the widget does not have a parent.
   */
  get parent(): Widget {
    return this._parent;
  }

  /**
   * Set the parent of the widget.
   *
   * #### Notes
   * Children are typically added to a widget by using a layout, which
   * means user code will not normally set the parent widget directly.
   *
   * The widget will be automatically removed from its old parent.
   *
   * This is a no-op if there is no effective parent change.
   */
  set parent(value: Widget) {
    value = value || null;
    if (this._parent === value) {
      return;
    }
    if (value && this.contains(value)) {
      throw new Error('Invalid parent widget.');
    }
    if (this._parent && !this._parent.isDisposed) {
      sendMessage(this._parent, new ChildMessage('child-removed', this));
    }
    this._parent = value;
    if (this._parent && !this._parent.isDisposed) {
      sendMessage(this._parent, new ChildMessage('child-added', this));
    }
    sendMessage(this, WidgetMessage.ParentChanged);
  }

  /**
   * Get the layout for the widget.
   *
   * #### Notes
   * This will be `null` if the widget does not have a layout.
   */
  get layout(): Layout {
    return this._layout;
  }

  /**
   * Set the layout for the widget.
   *
   * #### Notes
   * The layout is single-use only. It cannot be set to `null` and it
   * cannot be changed after the first assignment.
   *
   * The layout is disposed automatically when the widget is disposed.
   */
  set layout(value: Layout) {
    value = value || null;
    if (this._layout === value) {
      return;
    }
    if (this.testFlag(WidgetFlag.DisallowLayout)) {
      throw new Error('Cannot set widget layout.');
    }
    if (this._layout) {
      throw new Error('Cannot change widget layout.');
    }
    if (value.parent) {
      throw new Error('Cannot change layout parent.');
    }
    this._layout = value;
    value.parent = this;
    sendMessage(this, WidgetMessage.LayoutChanged);
  }

  /**
   * Create an iterator over the widget's children.
   *
   * @returns A new iterator over the children of the widget.
   *
   * #### Notes
   * The widget must have a populated layout in order to have children.
   *
   * If a layout is not installed, the returned iterator will be empty.
   */
  children(): IIterator<Widget> {
    return iter(this._layout || EmptyIterator.instance);
  }

  /**
   * Test whether a widget is a descendant of this widget.
   *
   * @param widget - The descendant widget of interest.
   *
   * @returns `true` if the widget is a descendant, `false` otherwise.
   */
  contains(widget: Widget): boolean {
    for (; widget; widget = widget._parent) {
      if (widget === this) return true;
    }
    return false;
  }

  /**
   * Test whether the widget's DOM node has the given class name.
   *
   * @param name - The class name of interest.
   *
   * @returns `true` if the node has the class, `false` otherwise.
   */
  hasClass(name: string): boolean {
    return this._node.classList.contains(name);
  }

  /**
   * Add a class name to the widget's DOM node.
   *
   * @param name - The class name to add to the node.
   *
   * #### Notes
   * If the class name is already added to the node, this is a no-op.
   *
   * The class name must not contain whitespace.
   */
  addClass(name: string): void {
    this._node.classList.add(name);
  }

  /**
   * Remove a class name from the widget's DOM node.
   *
   * @param name - The class name to remove from the node.
   *
   * #### Notes
   * If the class name is not yet added to the node, this is a no-op.
   *
   * The class name must not contain whitespace.
   */
  removeClass(name: string): void {
    this._node.classList.remove(name);
  }

  /**
   * Toggle a class name on the widget's DOM node.
   *
   * @param name - The class name to toggle on the node.
   *
   * @param force - Whether to force add the class (`true`) or force
   *   remove the class (`false`). If not provided, the presence of
   *   the class will be toggled from its current state.
   *
   * @returns `true` if the class is now present, `false` otherwise.
   *
   * #### Notes
   * The class name must not contain whitespace.
   */
  toggleClass(name: string, force?: boolean): boolean {
    if (force === true) {
      this._node.classList.add(name);
      return true;
    }
    if (force === false) {
      this._node.classList.remove(name);
      return false;
    }
    return this._node.classList.toggle(name);
  }

  /**
   * Post an `'update-request'` message to the widget.
   *
   * #### Notes
   * This is a simple convenience method for posting the message.
   */
  update(): void {
    postMessage(this, WidgetMessage.UpdateRequest);
  }

  /**
   * Post a `'fit-request'` message to the widget.
   *
   * #### Notes
   * This is a simple convenience method for posting the message.
   */
  fit(): void {
    postMessage(this, WidgetMessage.FitRequest);
  }

  /**
   * Send a `'close-request'` message to the widget.
   *
   * #### Notes
   * This is a simple convenience method for sending the message.
   */
  close(): void {
    sendMessage(this, WidgetMessage.CloseRequest);
  }

  /**
   * Show the widget and make it visible to its parent widget.
   *
   * #### Notes
   * This causes the [[isHidden]] property to be `false`.
   *
   * If the widget is not explicitly hidden, this is a no-op.
   */
  show(): void {
    if (!this.testFlag(WidgetFlag.IsHidden)) {
      return;
    }
    this.clearFlag(WidgetFlag.IsHidden);
    this.removeClass(HIDDEN_CLASS);
    if (this.isAttached && (!this.parent || this.parent.isVisible)) {
      sendMessage(this, WidgetMessage.AfterShow);
    }
    if (this.parent) {
      sendMessage(this.parent, new ChildMessage('child-shown', this));
    }
  }

  /**
   * Hide the widget and make it hidden to its parent widget.
   *
   * #### Notes
   * This causes the [[isHidden]] property to be `true`.
   *
   * If the widget is explicitly hidden, this is a no-op.
   */
  hide(): void {
    if (this.testFlag(WidgetFlag.IsHidden)) {
      return;
    }
    if (this.isAttached && (!this.parent || this.parent.isVisible)) {
      sendMessage(this, WidgetMessage.BeforeHide);
    }
    this.setFlag(WidgetFlag.IsHidden);
    this.addClass(HIDDEN_CLASS);
    if (this.parent) {
      sendMessage(this.parent, new ChildMessage('child-hidden', this));
    }
  }

  /**
   * Show or hide the widget according to a boolean value.
   *
   * @param hidden - `true` to hide the widget, or `false` to show it.
   *
   * #### Notes
   * This is a convenience method for `hide()` and `show()`.
   */
  setHidden(hidden: boolean): void {
    if (hidden) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Test whether the given widget flag is set.
   *
   * #### Notes
   * This will not typically be called directly by user code.
   */
  testFlag(flag: WidgetFlag): boolean {
    return (this._flags & flag) !== 0;
  }

  /**
   * Set the given widget flag.
   *
   * #### Notes
   * This will not typically be called directly by user code.
   */
  setFlag(flag: WidgetFlag): void {
    this._flags |= flag;
  }

  /**
   * Clear the given widget flag.
   *
   * #### Notes
   * This will not typically be called directly by user code.
   */
  clearFlag(flag: WidgetFlag): void {
    this._flags &= ~flag;
  }

  /**
   * Process a message sent to the widget.
   *
   * @param msg - The message sent to the widget.
   *
   * #### Notes
   * Subclasses may reimplement this method as needed.
   */
  processMessage(msg: Message): void {
    switch (msg.type) {
    case 'resize':
      this.notifyLayout(msg);
      this.onResize(msg as ResizeMessage);
      break;
    case 'update-request':
      this.notifyLayout(msg);
      this.onUpdateRequest(msg);
      break;
    case 'after-show':
      this.setFlag(WidgetFlag.IsVisible);
      this.notifyLayout(msg);
      this.onAfterShow(msg);
      break;
    case 'before-hide':
      this.notifyLayout(msg);
      this.onBeforeHide(msg);
      this.clearFlag(WidgetFlag.IsVisible);
      break;
    case 'after-attach':
      let visible = !this.isHidden && (!this.parent || this.parent.isVisible);
      if (visible) this.setFlag(WidgetFlag.IsVisible);
      this.setFlag(WidgetFlag.IsAttached);
      this.notifyLayout(msg);
      this.onAfterAttach(msg);
      break;
    case 'before-detach':
      this.notifyLayout(msg);
      this.onBeforeDetach(msg);
      this.clearFlag(WidgetFlag.IsVisible);
      this.clearFlag(WidgetFlag.IsAttached);
      break;
    case 'close-request':
      this.notifyLayout(msg);
      this.onCloseRequest(msg);
      break;
    case 'child-added':
      this.notifyLayout(msg);
      this.onChildAdded(msg as ChildMessage);
      break;
    case 'child-removed':
      this.notifyLayout(msg);
      this.onChildRemoved(msg as ChildMessage);
      break;
    default:
      this.notifyLayout(msg);
      break;
    }
  }

  /**
   * Invoke the message processing routine of the widget's layout.
   *
   * @param msg - The message to dispatch to the layout.
   *
   * #### Notes
   * This is a no-op if the widget does not have a layout.
   *
   * This will not typically be called directly by user code.
   */
  protected notifyLayout(msg: Message): void {
    if (this._layout) this._layout.processParentMessage(msg);
  }

  /**
   * A message handler invoked on a `'close-request'` message.
   *
   * #### Notes
   * The default implementation unparents or detaches the widget.
   */
  protected onCloseRequest(msg: Message): void {
    if (this.parent) {
      this.parent = null;
    } else if (this.isAttached) {
      Widget.detach(this);
    }
  }

  /**
   * A message handler invoked on a `'resize'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onResize(msg: ResizeMessage): void { }

  /**
   * A message handler invoked on an `'update-request'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onUpdateRequest(msg: Message): void { }

  /**
   * A message handler invoked on an `'after-show'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onAfterShow(msg: Message): void { }

  /**
   * A message handler invoked on a `'before-hide'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onBeforeHide(msg: Message): void { }

  /**
   * A message handler invoked on an `'after-attach'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onAfterAttach(msg: Message): void { }

  /**
   * A message handler invoked on a `'before-detach'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onBeforeDetach(msg: Message): void { }

  /**
   * A message handler invoked on a `'child-added'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onChildAdded(msg: ChildMessage): void { }

  /**
   * A message handler invoked on a `'child-removed'` message.
   *
   * #### Notes
   * The default implementation of this handler is a no-op.
   */
  protected onChildRemoved(msg: ChildMessage): void { }

  private _flags = 0;
  private _node: HTMLElement;
  private _layout: Layout = null;
  private _parent: Widget = null;
}


/**
 * The namespace for the `Widget` class statics.
 */
export
namespace Widget {
  /**
   * A signal emitted when the widget is disposed.
   */
  export
  const disposed = new Signal<Widget, void>();

  /**
   * Attach a widget to a host DOM node.
   *
   * @param widget - The widget of interest.
   *
   * @param host - The DOM node to use as the widget's host.
   *
   * #### Notes
   * This will throw an error if the widget is not a root widget, if
   * the widget is already attached, or if the host is not attached
   * to the DOM.
   */
  export
  function attach(widget: Widget, host: HTMLElement): void {
    if (widget.parent) {
      throw new Error('Cannot attach child widget.');
    }
    if (widget.isAttached || document.body.contains(widget.node)) {
      throw new Error('Widget already attached.');
    }
    if (!document.body.contains(host)) {
      throw new Error('Host not attached.');
    }
    host.appendChild(widget.node);
    sendMessage(widget, WidgetMessage.AfterAttach);
  }

  /**
   * Detach the widget from its host DOM node.
   *
   * @param widget - The widget of interest.
   *
   * #### Notes
   * This will throw an error if the widget is not a root widget, or
   * if the widget is not attached to the DOM.
   */
  export
  function detach(widget: Widget): void {
    if (widget.parent) {
      throw new Error('Cannot detach child widget.');
    }
    if (!widget.isAttached || !document.body.contains(widget.node)) {
      throw new Error('Widget not attached.');
    }
    sendMessage(widget, WidgetMessage.BeforeDetach);
    widget.node.parentNode.removeChild(widget.node);
  }
}


/**
 * An enum of widget bit flags.
 */
export
enum WidgetFlag {
  /**
   * The widget has been disposed.
   */
  IsDisposed = 0x1,

  /**
   * The widget is attached to the DOM.
   */
  IsAttached = 0x2,

  /**
   * The widget is hidden.
   */
  IsHidden = 0x4,

  /**
   * The widget is visible.
   */
  IsVisible = 0x8,

  /**
   * A layout cannot be set on the widget.
   */
  DisallowLayout = 0x10
}


/**
 * The namespace for the `Widget` private data.
 */
namespace WidgetPrivate {
  /**
   * An attached property for the widget title object.
   */
  export
  const title = new AttachedProperty<Widget, Title<Widget>>({
    name: 'title',
    create: owner => new Title({ owner }),
  });
}