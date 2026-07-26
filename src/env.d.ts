/// <reference types="astro/client" />
/// <reference types="node" />

declare namespace App {
  interface Locals {
    protectedAuthorized: boolean;
    protectedAvailable: boolean;
  }
}
