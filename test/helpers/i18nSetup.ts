if (!('showPopover' in HTMLElement.prototype)) {
  const dispatchToggleEvent = (element: HTMLElement, newState: 'open' | 'closed') => {
    const event = new Event('toggle');
    Object.defineProperty(event, 'newState', { value: newState });
    element.dispatchEvent(event);
  };

  HTMLElement.prototype.showPopover = function showPopover() {
    this.dataset.popoverOpen = 'true';
    dispatchToggleEvent(this, 'open');
  };

  HTMLElement.prototype.hidePopover = function hidePopover() {
    delete this.dataset.popoverOpen;
    dispatchToggleEvent(this, 'closed');
  };

  HTMLElement.prototype.togglePopover = function togglePopover() {
    if (this.dataset.popoverOpen === 'true') {
      this.hidePopover();
    } else {
      this.showPopover();
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const popoverTarget = target.closest<HTMLElement>('[popovertarget]');
      if (popoverTarget) {
        const popoverId = popoverTarget.getAttribute('popovertarget');
        const popover = popoverId ? document.getElementById(popoverId) : null;
        popover?.togglePopover();
        return;
      }

      if (target.closest('[popover="auto"]')) {
        return;
      }

      document.querySelector<HTMLElement>('[popover="auto"][data-popover-open="true"]')?.hidePopover();
    },
    true,
  );
}
