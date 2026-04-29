class StudyAppException(Exception):
    """Base class for expected application exceptions."""


class ResourceNotFoundException(StudyAppException):
    def __init__(self, resource: str = "Resource") -> None:
        super().__init__(f"{resource} not found")


class ForbiddenException(StudyAppException):
    def __init__(self, message: str = "You do not have access to this resource") -> None:
        super().__init__(message)


class ValidationException(StudyAppException):
    pass


class LLMException(StudyAppException):
    pass
