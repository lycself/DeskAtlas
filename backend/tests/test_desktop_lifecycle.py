"""Exercise desktop exit paths without starting a native GUI or tray."""

import importlib.util
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[2]


def load_gui_module(name, monkeypatch, dependency, fake):
    monkeypatch.setitem(sys.modules, dependency, fake)
    spec = importlib.util.spec_from_file_location(f"desktop._test_{name}", ROOT / "desktop" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("first_result", [False, True, "error"])
def test_quit_returns_to_tray_loop_and_handles_cancel_retry(monkeypatch, first_result):
    module = load_gui_module("tray", monkeypatch, "pystray", SimpleNamespace(Menu=None, MenuItem=None))
    tray = module.Tray.__new__(module.Tray)
    tray._quit_lock = threading.Lock()
    requested = []
    notices = []
    tray.controller = SimpleNamespace(request_quit=lambda: requested.append(True))
    tray.notify = notices.append
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def confirm(*args):
        calls.append(threading.current_thread())
        entered.set()
        assert release.wait(3)
        if len(calls) == 1:
            if first_result == "error":
                raise OSError("dialog unavailable")
            return first_result
        return True

    monkeypatch.setattr(module.hostos, "confirm", confirm)
    caller = threading.Thread(target=tray._quit)
    try:
        caller.start()
        assert entered.wait(3)
        caller.join(1)
        assert not caller.is_alive(), "The tray callback must return while the dialog is open"
        assert calls[0] is not caller
        tray._quit()
        assert len(calls) == 1, "Repeated clicks must not open duplicate dialogs"
        assert requested == []
    finally:
        release.set()
        caller.join(3)
        if calls:
            calls[0].join(3)
    assert not calls[0].is_alive()
    assert requested == ([True] if first_result is True else [])
    assert bool(notices) == (first_result == "error")
    assert not tray._quit_lock.locked()

    if first_result is not True:
        entered.clear()
        tray._quit()
        assert entered.wait(3)
        calls[-1].join(3)
        assert requested == [True]


def test_explicit_exit_closes_window_but_titlebar_close_only_hides(monkeypatch):
    class ClosingEvent:
        def __iadd__(self, callback):
            self.callback = callback
            return self

    class NativeWindow:
        def __init__(self):
            self.events = SimpleNamespace(closing=ClosingEvent())
            self.hidden = 0
            self.closed = False

        def hide(self):
            self.hidden += 1

        def destroy(self):
            self.closed = self.events.closing.callback() is not False

    native = NativeWindow()
    module = load_gui_module("window", monkeypatch, "webview", SimpleNamespace(create_window=lambda *args, **kwargs: native))
    controller = SimpleNamespace(panel_url=lambda: "http://127.0.0.1:8080/panel")
    panel = module.PanelWindow(controller)
    assert native.events.closing.callback() is False
    assert native.hidden == 1 and not native.closed
    panel.destroy()
    assert native.closed
    assert native.hidden == 1, "Explicit exit must not hide and veto native destruction"
