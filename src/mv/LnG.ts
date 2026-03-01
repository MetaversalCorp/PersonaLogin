function ensureLnGReady() {
    return new Promise((resolve) => {
        const onReadyState = () => {
            if (pFabric.IsReady()) {
                resolve();
            }
        };

        pFabric.Attach(onReadyState);
    });
}