---
title: Build and run CyberGold App
doc_type: developer-guide
status: active
owner: app-maintainer
created: 2026-10-12
last_reviewed: 2026-10-12
canonical_for: Public source build and local runtime instructions
---

# Build and run this App source

This package contains the authored App runtime, assets, original package locks,
Dockerfile and compact inputs for regenerating its checked-in ABI modules.
A Git checkout identifies its source with `git rev-parse HEAD`; retained source
packages record their original versions in `source-info.json`. Existing
upstream notices and licenses remain included.

Use Docker with BuildKit and Python 3 for the wrapper. The Dockerfile selects
Node 26.10.0 by image digest, installs the original locked npm packages, and
uses Next's existing webpack build. Public npm/base-image access is needed;
private Ops access and Git history are unnecessary.

From this extracted directory:

```sh
bash scripts/build-public-image.sh . cybergold-app:local runner env/app-public.example.env
docker run --rm --add-host host.docker.internal:host-gateway -p 127.0.0.1:3000:3000 --env-file env/app-runtime.example.env cybergold-app:local
```

Choose your own local chain/RPC/backend inputs in copies of the example files.
The address `0x...0001` in the Backend example is a placeholder, not a deployed
Core. Contract operations need your actual deployment; ordinary provider errors
remain ordinary errors. Browser-visible variables go in the public build file.
Private backend credentials, if your own backend requires them, belong only in
your runtime file. No deployed key, database value or B2B profile is supplied.

The `runner` target compiles a production standalone application. The existing
`development` target was used for Sandbox; build it by replacing `runner` with
`development` and pass the public file at runtime as well as the runtime file:

```sh
bash scripts/build-public-image.sh . cybergold-app:development development env/app-public.example.env
docker run --rm --add-host host.docker.internal:host-gateway -p 127.0.0.1:3000:3000 --env-file env/app-public.example.env --env-file env/app-runtime.example.env cybergold-app:development
```

The wrapper uses the checkout commit as its build identity. For an extracted
retained package, `CG_SOURCE_COMMIT=<listed version>` selects the original
version recorded in `source-info.json`; this does not create Git history. For direct local development, use Node from `.nvmrc`, `npm ci`, copy
the public and runtime examples into `.env.local`, then run `npm run dev`.

`node scripts/regenerate-offer-abis.mjs --check` proves that the compact ABI
inputs produce the original generated modules. They are reconstructed rendering
inputs, recorded as such, rather than original sealed compiler artifacts.
No Solidity compilation is needed to build this App. Original tests remain;
full CI may also need the public Protocol/Helpers sibling checkers documented
in the repositories. Public Docker builds use neither those siblings nor Ops.

These steps build a usable source-derived image. They do not attest to the
deployed OCI digest: original public build-environment bytes, apt resolution,
BuildKit/frontend/layer metadata and external package availability are not all
captured. This source package is a local review candidate until published.
