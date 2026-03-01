function ensureLnGReady() {
    // Detach previous services if any
    MSF.Detach();

    // Attach the required services
    MSF.Attach();

    // Check if it's ready
    if (MSF.IsReady()) {
        return MSF.GetLnG();
    }
    return null;
}