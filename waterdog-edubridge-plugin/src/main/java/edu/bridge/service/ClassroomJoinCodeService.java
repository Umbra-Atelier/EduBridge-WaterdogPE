package edu.bridge.service;

import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

/**
 * Drop-in compatibility alias in `edu.bridge.service` extending `edu.bridge.joincode.ClassroomJoinCodeService`.
 * Ensures any custom fork or external reference to `edu.bridge.service.ClassroomJoinCodeService` compiles cleanly.
 */
public class ClassroomJoinCodeService extends edu.bridge.joincode.ClassroomJoinCodeService {

    public ClassroomJoinCodeService(EduBridgeConfig config, Logger logger) {
        super(config, logger);
    }

    public ClassroomJoinCodeService() {
        super();
    }
}
