"""KeepKeys Hermes plugin entry point."""

from .adapters.hermes.plugin import register

__all__ = ["register"]
